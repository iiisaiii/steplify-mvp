# -*- coding: utf-8 -*-
"""
Google Sheets (CSV) -> Playbook JSON dönüştürücü
"""
import argparse, csv, json, sys, re

def norm(s): return (s or "").strip()

# ---- helpers ----
def parse_list(cell):
    cell = (cell or "").strip()
    if not cell:
        return []
    # [A, B] -> A, B
    if cell.startswith('[') and cell.endswith(']'):
        cell = cell[1:-1]
    # virgül veya | ile ayır
    parts = [p.strip() for p in re.split(r'[,\|]', cell) if p.strip()]
    cleaned = []
    for p in parts:
        # "=info:" veya "= ..." gibi kuyrukları kırp
        p = re.split(r'\s*=\s*', p, 1)[0]
        p = re.split(r'(?i)\s*info\s*:\s*', p, 1)[0]
        p = p.strip().strip('"').strip("'")
        if p in ("-", "—", "–", "[-]", "[ - ]", "[]", "[ ]", "."):
            continue
        if p:
            cleaned.append(p)
    return cleaned

def parse_links(cell):
    cell = (cell or "").strip()
    if not cell or cell in ("-", "—", "–"):
        return []
    return [p.strip() for p in cell.split(',') if p.strip() and p.strip() not in ("-", "—", "–")]

def split_multi(s, seps):
    if not s: return []
    reg = "|".join([re.escape(x) for x in seps])
    return [p.strip(" -•\t") for p in re.split(reg, s) if p and p.strip(" -•\t")]

def parse_option_details(cell):
    """
    "A=info: ... | pros: p1; p2 | cons: c1, c2 || B: info: ... | pros: ... | cons: ..."
    => {"A":{"info":"...", "pros":[...], "cons":[...]}, "B":{...}}
    """
    cell = norm(cell)
    if not cell: return {}
    out = {}
    for seg in [x.strip() for x in cell.split("||") if x.strip()]:
        m = re.match(r'^\s*([^=:|]+?)\s*(?:=|:)\s*(.*)$', seg)
        if m:
            label, body = norm(m.group(1)), norm(m.group(2))
        else:
            label, body = norm(seg), ""
        info, pros, cons = "", [], []
        parts = [p.strip() for p in re.split(r"\|", body) if p.strip()] if body else []
        for p in parts:
            if ":" in p:
                key, val = p.split(":", 1)
                key, val = norm(key).lower(), norm(val)
            else:
                key, val = "info", norm(p)
            if key in ("info", "nedir"):
                info = val
            elif key in ("pros","arti","artı","artilar","artılar","artilari","artıları"):
                pros = [x for x in split_multi(val, [";", ",", "|"]) if x]
            elif key in ("cons","eksi","eksiler","eksileri"):
                cons = [x for x in split_multi(val, [";", ",", "|"]) if x]
        out[label] = {"info": info, "pros": pros, "cons": cons}
    return out

def parse_glossary(cell):
    cell = norm(cell)
    if not cell: return {}
    out = {}
    for seg in [x.strip() for x in cell.split("||") if x.strip()]:
        if ":" in seg:
            term, desc = seg.split(":", 1)
            out[norm(term)] = norm(desc)
        else:
            out[norm(seg)] = ""
    return out

# ---- main ----
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_path", required=True)
    ap.add_argument("--model", dest="model_name", required=True)
    ap.add_argument("--out", dest="out_path", default=None)
    args = ap.parse_args()

    with open(args.in_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            print("CSV başlıkları okunamadı.", file=sys.stderr); sys.exit(1)

        cmap = {}
        # Önce daha özgül başlıkları eşle (çakışmayı engelle)
        for k in reader.fieldnames:
            low = k.strip().lower()
            if re.search(r'seçenek\s*detay|secenek\s*detay|option\s*detail', low):
                cmap["SeçenekDetay"] = k
            if re.search(r'görünür\s*eğer|gorunur\s*eger|görünür|gorunur|visible', low):
                cmap["GörünürEğer"] = k
            if re.search(r'terimler|sözlük|sozluk|glossary', low):
                cmap["Terimler"] = k

        for k in reader.fieldnames:
            low = k.strip().lower()
            if "stepid" in low:                        cmap["StepID"] = k
            elif "parentid" in low:                    cmap["ParentID"] = k
            elif ("başlık" in low) or ("baslik" in low) or ("title" in low):
                cmap["Başlık"] = k
            elif ("açıklama" in low) or ("aciklama" in low) or ("desc" in low):
                cmap["Açıklama"] = k
            elif re.search(r'\b(seçenekler|secenekler|options)\b', low) and "detay" not in low:
                cmap["Seçenekler"] = k
            elif ("kaynak" in low) or ("link" in low):
                cmap["Kaynak/Link"] = k

        needed = ["StepID","ParentID","Başlık","Açıklama","Seçenekler","Kaynak/Link"]
        for n in needed:
            if n not in cmap:
                print("Eksik kolon:", n, file=sys.stderr); sys.exit(1)

        steps = []
        for r in reader:
            try:
                sid = int(str(r[cmap["StepID"]]).strip())
            except:
                continue
            pid = int(str(r[cmap["ParentID"]]).strip() or 0)
            visible_if = norm(r.get(cmap.get("GörünürEğer",""), "")) if "GörünürEğer" in cmap else ""
            option_details = parse_option_details(r.get(cmap.get("SeçenekDetay",""), ""))
            glossary = parse_glossary(r.get(cmap.get("Terimler",""), ""))

            steps.append({
                "id": sid,
                "parentId": pid,
                "title": norm(r[cmap["Başlık"]]),
                "description": norm(r[cmap["Açıklama"]]),
                "options": parse_list(r[cmap["Seçenekler"]]),
                "links": parse_links(r[cmap["Kaynak/Link"]]),
                "visibleIf": visible_if,
                "optionDetails": option_details,
                "glossary": glossary
            })

    steps.sort(key=lambda x: x["id"])
    data = {"model": args.model_name, "steps": steps}
    out = args.out_path or f"public/data/{args.model_name.lower().replace(' ','_')}.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("Yazıldı:", out)

if __name__ == "__main__":
    main()
