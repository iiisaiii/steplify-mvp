# -*- coding: utf-8 -*-
"""
Google Sheets (CSV) -> Playbook JSON dönüştürücü
Kullanım:
  python scripts/sheets_to_json.py --in "public/data/Affiliate.csv" --model "Affiliate" --out "public/data/affiliate.json"
CSV Kolonları (case-insensitive):
StepID, ParentID, Başlık, Açıklama, Seçenekler, Kaynak/Link
"""
import argparse, csv, json, sys

def norm(s): return (s or "").strip()

def parse_options(cell):
    cell = (cell or "").strip()
    if not cell: return []
    if cell.startswith('[') and cell.endswith(']'):
        cell = cell[1:-1]
    return [p.strip() for p in cell.split(',') if p.strip()]

def parse_links(cell):
    cell = (cell or "").strip()
    if not cell: return []
    return [p.strip() for p in cell.split(',') if p.strip()]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_path", required=True)
    ap.add_argument("--model", dest="model_name", required=True)
    ap.add_argument("--out", dest="out_path", default=None)
    args = ap.parse_args()

    with open(args.in_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        cmap = {}
        for k in reader.fieldnames:
            low = k.strip().lower()
            if "stepid" in low: cmap["StepID"] = k
            elif "parentid" in low: cmap["ParentID"] = k
            elif "başlık" in low or "baslik" in low or "title" in low: cmap["Başlık"] = k
            elif "açıklama" in low or "aciklama" in low or "desc" in low: cmap["Açıklama"] = k
            elif "seçenek" in low or "secenek" in low or "options" in low: cmap["Seçenekler"] = k
            elif "kaynak" in low or "link" in low: cmap["Kaynak/Link"] = k

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
            steps.append({
                "id": sid,
                "parentId": pid,
                "title": norm(r[cmap["Başlık"]]),
                "description": norm(r[cmap["Açıklama"]]),
                "options": parse_options(r[cmap["Seçenekler"]]),
                "links": parse_links(r[cmap["Kaynak/Link"]])
            })

    steps.sort(key=lambda x: x["id"])
    data = {"model": args.model_name, "steps": steps}
    out = args.out_path or f"public/data/{args.model_name.lower().replace(' ','_')}.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("Yazıldı:", out)

if __name__ == "__main__":
    main()
