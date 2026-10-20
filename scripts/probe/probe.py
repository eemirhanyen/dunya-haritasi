import urllib.request, datetime as dt, time, sys, os
UA={"User-Agent":"dunya-haritasi/1.0"}
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=120) as r: return r.read()
now=dt.datetime.utcnow()
for back in range(0,24,6):
    run=now-dt.timedelta(hours=back+4); run=run.replace(hour=run.hour//6*6)
    d=run.strftime("%Y%m%d"); h=run.strftime("%H")
    url=(f"https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl?dir=%2Fgfs.{d}%2F{h}%2Fatmos&file=gfs.t{h}z.pgrb2.1p00.f003"
         "&var_UGRD=on&var_VGRD=on&var_TMP=on&var_TCDC=on&var_PRATE=on&lev_10_m_above_ground=on&lev_2_m_above_ground=on&lev_entire_atmosphere=on&lev_surface=on")
    try:
        b=get(url); print("OK",d,h,len(b)); open("/tmp/g.grb2","wb").write(b); break
    except Exception as e: print("ERR",d,h,e)
t=time.time()
os.system(f"{sys.executable} -m pip install -q eccodes eccodeslib 2>&1 | tail -2")
print("pip",round(time.time()-t))
try:
    import eccodes
    with open("/tmp/g.grb2","rb") as f:
        while True:
            g=eccodes.codes_grib_new_from_file(f)
            if g is None: break
            vals=eccodes.codes_get_values(g)
            print(eccodes.codes_get(g,"shortName"),eccodes.codes_get(g,"typeOfLevel"),eccodes.codes_get(g,"level"),
                  eccodes.codes_get(g,"Ni"),eccodes.codes_get(g,"Nj"),eccodes.codes_get(g,"latitudeOfFirstGridPointInDegrees"),
                  eccodes.codes_get(g,"longitudeOfFirstGridPointInDegrees"),round(float(vals.min()),3),round(float(vals.max()),3))
            eccodes.codes_release(g)
except Exception as e: print("DECODE ERR",repr(e))
