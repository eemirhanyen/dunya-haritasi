import json, time, sys, os, urllib.request, urllib.parse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import fetch_news as fn
cands = {
 "USA":["^GSPC"],"CAN":["^GSPTSE"],"MEX":["^MXX"],"BRA":["^BVSP"],"ARG":["^MERV"],"CHL":["^IPSA"],"PER":["^SPBLPGPT"],"COL":["^COLCAP","ICOLCAP.CL"],
 "GBR":["^FTSE"],"DEU":["^GDAXI"],"FRA":["^FCHI"],"ITA":["FTSEMIB.MI"],"ESP":["^IBEX"],"NLD":["^AEX"],"BEL":["^BFX"],"CHE":["^SSMI"],"AUT":["^ATX"],
 "SWE":["^OMX"],"NOR":["OBX.OL","^OSEAX"],"DNK":["^OMXC25"],"FIN":["^OMXH25"],"POL":["WIG20.WA","^WIG20"],"PRT":["PSI20.LS","^PSI20"],"IRL":["^ISEQ"],
 "CZE":["^PX","FPXAA.PR"],"HUN":["^BUX","^BUX.BD"],"ROU":["^BETI","BET.RO"],"GRC":["GD.AT"],"TUR":["XU100.IS"],"ISR":["TA35.TA"],"RUS":["IMOEX.ME"],
 "SAU":["^TASI.SR"],"EGY":["^CASE30"],"ZAF":["^J203.JO","^JN0U.JO"],"NGA":["^NGSEINDX"],"KEN":["^NSE20"],"MAR":["^MASI"],
 "IND":["^NSEI","^BSESN"],"PAK":["^KSE"],"CHN":["000001.SS"],"HKG":["^HSI"],"JPN":["^N225"],"KOR":["^KS11"],"SGP":["^STI"],"MYS":["^KLSE"],
 "IDN":["^JKSE"],"THA":["^SET.BK"],"PHL":["PSEI.PS"],"VNM":["^VNINDEX.VN","VNINDEX"],"AUS":["^AXJO"],"NZL":["^NZ50"],"QAT":["^QSI"],"ARE":["^ADI","DFMGI.AE"],"KWT":["^BKA"],
}
print("=== YAHOO")
ok = {}
for iso, syms in cands.items():
    for s in syms:
        try:
            m = fn.market(s)
            print(iso, s, "OK", m["name"], m["currency"], m["last"], m["as_of"][:10], m["chg_1d"], m["chg_1m"])
            ok.setdefault(iso, s)
            break
        except Exception as e:
            print(iso, s, "FAIL", str(e)[:80])
        time.sleep(0.5)
print("OKMAP", json.dumps(ok))
print("=== GDELT")
tests = [("GRC", fn.local_query(["GR"])), ("ISR", fn.intl_query("ISR","Israel",["IS"])), ("TUR", fn.intl_query("TUR","Turkiye",["TU"])), ("PSE", fn.local_query(["GZ","WE"]))]
for iso, q in tests:
    try:
        arts = fn.clean(fn.gdelt(q, 20), 20)
        print(iso, q, len(arts))
        for a in arts[:3]: print("    ", a["time"], a["domain"], a["lang"], "|", a["title"][:90])
    except Exception as e:
        print(iso, q, "ERR", str(e)[:200])
