# -*- coding: utf-8 -*-
"""
Google Sheets (CSV) -> Playbook JSON dönüştürücü (sade)
Söz dizimi (özet):
- Seçenekler: "A | B | C" ya da "[A, B, C]"
- GörünürEğer: step:ID=Değer1|Değer2, step:K=...
- SeçenekDetay:
    Label = info: ... | pros: a; b | cons: c; d  ||  Label2 = ...
  veya direkt JSON:
    {"Label":{"info":"...","pros":["..."],"cons":["..."]}, ...}
- Terimler: "Shopify: ... || WooCommerce: ..."
"""
import argparse, csv, json, sys

def norm(s): return (s or "").strip()

def parse_list(cell: str):
    s = norm(cell)
    if not s: return []
    if s.startswith("[") and s.endswith("]"):
        s = s[1:-1]
    # | , ; hepsini virgüna çevirip parçala
    s = s.replace("|", ",").replace(";", ",")
    return [p.strip() for p in s.split(",") if p.strip() and p.strip() != "-"]

def parse_links(cell: str):
    s = norm(cell)
    if not s: return []
    s = s.replace("|", ",")
    return [p.strip() for p in s.split(",") if p.strip() and p.strip() != "-"]

def parse_option_details(cell: str):
    """
    DSL: "A = info: ... | pros: p1; p2 | cons: c1; c2 || B = info: ..."
    veya JSON: '{"A":{"info":"...","pros":[...],"cons":[...]}}'
    """
    s = norm(cell)
    if not s: return {}

    # JSON desteği (en kolay yol)
    if s.lstrip().startswith("{"):
        try:
            raw = json.loads(s)
            out = {}
            for label, d in raw.items():
                info = norm(d.get("info", ""))
                pros = d.get("pros", [])
                cons = d.get("cons", [])
                if isinstance(pros, str):  # "a; b" yazılmış olabilir
                    pros = [x.strip() for x in pros.replace("|", ";").replace(",", ";").split(";") if x.strip()]
                if isinstance(cons, str):
                    cons = [x.strip() for x in cons.replace("|", ";").replace(",", ";").split(";") if x.strip()]
                out[norm_label(label)] = {"info": info, "pros": pros, "cons": cons}
            return out
        except Exception:
            pass  # JSON değilse DSL'e düş

    # DSL
    out = {}
    blocks = [b.strip() for b in s.split("||") if b.strip()]
    for b in blocks:
        if "=" in b:
            label, body = b.split("=", 1)
        elif ":" in b:
            # "Label: info: ..." yazılmışsa da yakalarız
            label, body = b.split(":", 1)
        else:
            label, body = b, ""
        label = norm_label(label)

        info, pros, cons = "", [], []
        parts = [p.strip() for p in body.split("|") if p.strip()]
        for p in parts:
            if ":" not in p:
                # anahtar verilmeyip direkt info yazılmışsa
                info = (info + " " + p).strip()
                continue
            key, val = p.split(":", 1)
            key = norm(key).lower()
            val = norm(val)
            if key == "info":
                info = val
            elif key == "pros":
                pros = [x.strip() for x in val.replace("|", ";").replace(",", ";").split(";") if x.strip()]
            elif key == "cons":
                cons = [x.strip() for x in val.replace("|", ";").replace(",", ";").split(";") if x.strip()]

        out[label] = {"info": info, "pros": pros, "cons": cons}
    return out

def norm_label(s: str) -> str:
    # baş/son boşluk, gereksiz tire/kalın nokta temizliği
    return norm(s).strip(" -•\t")

def parse_glossary(cell: str):
    s = norm(cell)
    if not s: return {}
    out = {}
    for seg in [x.strip() for x in s.split("||") if x.strip()]:
        if ":" in seg:
            term, desc = seg.split(":", 1)
            out[norm(term)] = norm(desc)
        else:
            out[norm(seg)] = ""
    return out

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

        # başlık eşleştirmeleri (esnek ama basit)
        cmap = {}
        for k in reader.fieldnames:
            low = k.strip().lower()
            if "stepid" in low:                                       cmap["StepID"] = k
            elif "parentid" in low:                                   cmap["ParentID"] = k
            elif ("başlık" in low) or ("baslik" in low) or ("title" in low):             cmap["Başlık"] = k
            elif ("açıklama" in low) or ("aciklama" in low) or ("desc" in low):          cmap["Açıklama"] = k
            elif ("seçenek" in low) or ("secenek" in low) or ("options" in low):        cmap["Seçenekler"] = k
            elif ("kaynak" in low) or ("link" in low):                                    cmap["Kaynak/Link"] = k
            elif ("görünür" in low) or ("gorunur" in low) or ("visible" in low):        cmap["GörünürEğer"] = k
            elif ("seçenekdetay" in low) or ("secenekdetay" in low) or ("option" in low): cmap["SeçenekDetay"] = k
            elif ("terimler" in low) or ("sözlük" in low) or ("sozluk" in low) or ("glossary" in low): cmap["Terimler"] = k

        needed = ["StepID","ParentID","Başlık","Açıklama","Seçenekler","Kaynak/Link"]
        for n in needed:
            if n not in cmap:
                print("Eksik kolon:", n, file=sys.stderr); sys.exit(1)

        steps = []
        for r in reader:
            try:
                sid = int(str(r[cmap["StepID"]]).strip())
            except Exception:
                continue
            pid = int(str(r[cmap["ParentID"]]).strip() or 0)

            visible_if = norm(r.get(cmap.get("GörünürEğer",""), "")) if "GörünürEğer" in cmap else ""

            option_details = {}
            if "SeçenekDetay" in cmap:
                option_details = parse_option_details(r.get(cmap["SeçenekDetay"], ""))

            glossary = {}
            if "Terimler" in cmap:
                glossary = parse_glossary(r.get(cmap["Terimler"], ""))

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
