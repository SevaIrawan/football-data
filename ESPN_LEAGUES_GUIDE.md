# ESPN Leagues Reference & Cara Tambah Liga

Dokumen ini berisi:
- Daftar kode liga ESPN (soccer) yang bisa dipakai di `season.config.js`.
- Tata cara tambah liga, ganti musim, dan range tanggal.

## 1) Lokasi setting yang benar

- **Credential**: tetap di `.env`
- **Config musim/range/liga**: di `season.config.js`

## 2) Cara ganti musim

Edit di `season.config.js`:

```js
const SEASON_LABEL = "2025/26";
const ESPN_DATES_RANGE = "20250801-20260701";
```

Contoh musim baru:

```js
const SEASON_LABEL = "2026/27";
const ESPN_DATES_RANGE = "20260801-20270701";
```

## 3) Cara tambah liga baru

Tambah object baru di array `COMPETITIONS` pada `season.config.js`:

```js
{ espn_code: "idn.1", fd_code: null, name: "Indonesian Super League", logo_key: "indonesian-super-league" },
```

Catatan:
- `espn_code` wajib valid.
- `fd_code` dipakai Script3 (GW). Jika tidak ada coverage di football-data.org, isi `null`.
- `name` harus konsisten dengan nama liga yang ingin ditulis di Sheet.
- `logo_key` bebas, tapi sebaiknya slug rapi.

## 4) Checklist setelah tambah liga

1. Run `script1_fetch_schedule.js` → pastikan tidak `400` untuk liga baru.
2. Jika pakai Script 3 (GW), cek apakah `fd_code` valid. Jika tidak, set `null`.
3. Run `script2_update_results.js` (manual/batch) untuk menyapu hasil **FINISHED** yang banyak sekaligus.
4. Jika pakai **Script 2 LIVE** (`script2_live.js` / `run_script2_live.bat`), pastikan Task Scheduler memakai interval wajar (mis. 1–5 menit); LIVE mengikuti baris Sheet + `season.config.js`.

## 4b) Fallback manual GW (tanggal + tim)

Jika liga tidak tersedia di football-data.org (contoh: Indonesia pada API key tertentu), isi GW lewat file:

- `matchweek.manual.map.json`

Format 1 baris mapping:

```json
{
  "league_name": "Indonesian Super League",
  "season": "2025/26",
  "match_date": "2025/08/08",
  "home_name": "Borneo FC",
  "away_name": "Bhayangkara Surabaya",
  "matchweek": 1
}
```

Catatan:
- Kunci pencocokan: `league_name + season + match_date + home_name + away_name`.
- `match_date` bisa `yyyy/mm/dd` atau `yyyy-mm-dd`.
- Mapping manual diprioritaskan oleh `script3_update_matchweek.js` sebelum source API.

## 5) Daftar ESPN Soccer Leagues (espn_code)

Sumber: `https://sports.core.api.espn.com/v2/sports/soccer/leagues?limit=1000`

Format: `espn_code | displayName`

```text
afc.asian.cup | AFC Asian Cup
afc.challenge_cup | AFC Challenge Cup
afc.champions | AFC Champions League
afc.cup | AFC Champions League Two
afc.cupq | AFC Asian Cup Qualifiers
afc.saff.championship | SAFF Championship
afc.w.asian.cup | AFC Women's Asian Cup
aff.championship | AFF Cup
arg.1 | Argentine Primera División
arg.2 | Nacional B de Argentina
arg.3 | Primera División B de Argentina
arg.4 | Primera División C de Argentina
arg.copa | Copa Argentina
arg.copa_de_la_superliga | Copa Superliga de Argentina
arg.supercopa | Supercopa Argentina
arg.supercopa.internacional | Supercopa Internacional
arg.trofeo_de_la_campeones | Argentine Trofeo de Campeones
aus.1 | Australian A-League
aus.w.1 | Women's Australian League
aut.1 | Austrian Bundesliga
bangabandhu.cup | Bangabandhu Cup
bel.1 | Belgian Pro League
bel.promotion.relegation | Belgian Pro League Pro/Rel
bol.1 | Bolivian Liga Profesional
bol.copa | Copa Bolivia
bol.ply.rel | Bolivian Liga Profesional Promotion/Relegation Playoffs
bra.1 | Brazilian Futebol
bra.2 | Brasileirao B
bra.3 | Brasileirao C
bra.camp.carioca | Campeonato Carioca
bra.camp.gaucho | Campeonato Gaucho
bra.camp.mineiro | Campeonato Mineiro
bra.camp.paulista | Campeonato Paulista
bra.carioca.groupa | GROUPA
bra.carioca.groupb | Group B
bra.copa_do_brazil | Copa Do Brazil
bra.copa_do_nordeste | Copa Do Nordeste
bra.supercopa_do_brazil | SDB
caf.champions | CAF Champions League
caf.championship | African Nations Championship
caf.championship_qual | African Nations Championship Qualifying
caf.confed | CAF Confederation Cup
caf.cosafa | COSAFA Cup
caf.nations | Africa Cup of Nations
caf.nations_qual | African Nations Cup Qualifying
caf.w.nations | Women's Africa Cup of Nations
campeones.cup | Campeones Cup
can.w.nsl | Northern Super League
chi.1 | Chilean Primera División
chi.1.promotion.relegation | Chilean Pro/Rel
chi.2 | Segunda División
chi.copa_chi | Copa Chile
chi.super_cup | Chilean Supercopa
chn.1 | Chinese Super League
chn.1.promotion.relegation | Chinese Super League Promotion/Relegation Playoffs
club.friendly | Club Friendly
col.1 | Colombian Fútbol Profesional
col.2 | Colombia Segunda División
col.copa | Copa Águila
col.superliga | Colombian Superliga
concacaf.central.american.cup | Central American Cup
concacaf.champions | Concacaf Champions Cup
concacaf.champions_cup | Champions Cup
concacaf.confederations_playoff | Confederations Cup Playoff
concacaf.gold | CONCACAF Gold Cup
concacaf.gold_qual | Gold Cup Qualifying
concacaf.leagues.cup | Leagues Cup
concacaf.nations.league | Concacaf Nations League
concacaf.u23 | CONCACAF U23 Tournament
concacaf.w.champions_cup | W Champions Cup
concacaf.w.gold | W Gold Cup
concacaf.womens.championship | concacaf.womens.championship
conmebol.america | Copa América
conmebol.america.femenina | Copa América Femenina
conmebol.libertadores | CONMEBOL Libertadores
conmebol.recopa | Recopa Sudamericana
conmebol.sudamericana | CONMEBOL Sudamericana
crc.1 | Primera División de Costa Rica
cyp.1 | Cypriot First Division
den.1 | Danish SAS-Ligaen
ecu.1 | Ecuadoran Primera A
eng.1 | Premier League
eng.2 | English League Championship
eng.3 | English League One
eng.4 | English League Two
eng.5 | English Conference
eng.charity | English FA Community Shield
eng.fa | English FA Cup
eng.league_cup | English Carabao Cup
eng.trophy | Johnstone's Paint Trophy
eng.w.1 | FA Women's Super League
eng.w.fa | Women's FA Cup
eng.w.league_cup | Women's League Cup
esp.1 | LALIGA
esp.2 | Spanish LALIGA 2
esp.copa_de_la_reina | Spanish Copa de la Reina
esp.copa_del_rey | Spanish Copa del Rey
esp.joan_gamper | Trofeo Joan Gamper
esp.super_cup | Spanish Super Cup
esp.w.1 | Liga F
euroamericana.supercopa | SuperCopa Euroamericana
fifa.concacaf.olympicsq | Men's Olympic Qualifying Playoff
fifa.conmebol.olympicsq | CONMEBOL Pre-Olympic Tournament
fifa.cwc | FIFA Club World Cup
fifa.friendly | International Friendly
fifa.friendly_u21 | Men's U-21 Friendly
fifa.friendly.w | Women's International Friendly
fifa.intercontinental_cup | Intercontinental Cup
fifa.intercontinental_cup_not_used | Intercontinental Cup
fifa.intercontinental.cup | Intercontinental Cup
fifa.olympics | Men's Olympic Soccer Tournament
fifa.shebelieves | SheBelieves Cup
fifa.w.champions_cup | Women's Champions Cup
fifa.w.concacaf.olympicsq | Concacaf Women's Olympic Qualifying
fifa.w.olympics | Women's Olympic Soccer Tournament
fifa.wcq.ply | WCQ - Playoff Tournament
fifa.world | World Cup
fifa.world.u17 | U-17 World Cup
fifa.world.u20 | U-20 World Cup
fifa.worldq.afc | World Cup Qualifying - AFC
fifa.worldq.afc.conmebol | FIFA World Cup AFC/CONMEBOL Qualifying
fifa.worldq.caf | World Cup Qualifying - CAF
fifa.worldq.concacaf | World Cup Qualifying - CONCACAF
fifa.worldq.concacaf.ofc | FIFA World Cup CONCACAF/OFC Qualifying
fifa.worldq.conmebol | World Cup Qualifying - CONMEBOL
fifa.worldq.ofc | World Cup Qualifying - OFC
fifa.worldq.uefa | World Cup Qualifying - UEFA
fifa.wwc | Women's World Cup
fifa.wwcq.ply | WWCQ - Playoff Tournament
fifa.wworld.u17 | FIFA Under-17 Women's World Cup
fifa.wworldq.uefa | FIFA Women's World Cup Qualifying - UEFA
fra.1 | French Ligue 1
fra.1.promotion.relegation | French Ligue 1 Promotion/Relegation Playoffs
fra.2 | French Ligue 2
fra.coupe_de_france | French Coupe de France
fra.super_cup | French Super Cup
fra.w.1 | Division 1 Féminine
friendly.emirates_cup | Emirates Cup
ger.1 | Bundesliga
ger.2 | German 2. Bundesliga
ger.2.promotion.relegation | 2. Bundesliga Pro/Rel
ger.a.bayernliganorth | Regionalliga North
ger.dfb_pokal | German DFB Pokal
ger.playoff.relegation | Bundesliga Pro/Rel
ger.super_cup | German SuperCup
gha.1 | Ghanaian Premier League
global.arnold.clark_cup | Arnold Clark Cup
global.champs_cup | International Champions Cup
global.club_challenge | CONMEBOL-UEFA Club Challenge
global.finalissima | CONMEBOL-UEFA Cup of Champions
global.gulf_cup | Arabian Gulf Cup
global.pinatar_cup | Pinatar Cup
global.toulon | Tournoi Maurice Revello
global.u20.intercontinental_cup | U20 Intercontinental Cup
global.w.finalissima | Women's Finalissima
global.wchamps_cup | Women's International Champions Cup
gre.1 | Greek Super League
gua.1 | Liga Nacional de Guatemala
hon.1 | Primera División de Honduras
idn.1 | Indonesian Super League
ind.1 | Indian Super League
ind.2 | Indian I-League
ir1.1.promotion.relegation | Irish Premier Division Promotion/Relegation Playoffs
irl.1 | League of Ireland Premier Division
ita.1 | Italian Serie A
ita.2 | Italian Serie B
ita.coppa_italia | Italian Coppa Italia
ita.super_cup | Italian Super Cup
jpn.1 | Japanese J League
jpn.world_challenge | Japanese J.League World Challenge
ken.1 | Kenyan Premier League
ksa.1 | Saudi Pro League
ksa.kings.cup | Saudi King's Cup
mex.1 | Mexican Liga MX
mex.2 | Mexican Ascenso MX
mex.campeon | Mexican Campeon de Campeones
mys.1 | Malaysian Super League
ned.1 | Dutch Eredivisie
ned.2 | Dutch Eerste Divisie
ned.3 | Dutch Tweede Divisie
ned.3.promotion.relegation | Dutch Tweede Divisie Promotion/Relegation Playoffs
ned.cup | Dutch Cup
ned.playoff.relegation | Eredivisie Pro/Rel
ned.supercup | Dutch Johan Cruyff Shield
ned.w.1 | Dutch Vrouwen Eredivisie
ned.w.eredivisie_cup | Dutch Eredivisie Cup
ned.w.knvb_cup | Dutch KNVB Beker Vrouwen
nga.1 | Nigeria Professional League
nonfifa | Non-FIFA Friendly
nor.1 | Norwegian Tippeligaen
nor.1.promotion.relegation | Norwegian Eliteserien Pro/Rel
par.1 | Primera División de Paraguay
par.1.supercopa | Paraguayan Supercopa
per.1 | Peruvian Primera Profesional
por.1 | Portuguese Liga
por.1.promotion.relegation | Portuguese Liga Pro/Rel
por.taca.portugal | Taca de Portugal
rsa.1 | South African Premier
rsa.1.promotion.relegation | South African Premier Pro/Rel
rsa.2 | South African National First Division
rsa.mtn8 | South African MTN 8 Cup
rus.1 | Russian Premier League
rus.1.promotion.relegation | Russian Premier League Pro/Rel
sco.1 | Scottish Premiership
sco.1.promotion.relegation | SPFL Premiership Pro/Rel
sco.2 | Scottish Championship
sco.2.promotion.relegation | Scottish Championship Promotion/Relegation Playoffs
sco.challenge | Scottish League Challenge Cup
sco.cis | Scottish Communities League Cup
sco.tennents | Scottish Cup
sgp.1 | Singapore S-League
slv.1 | Primera División de El Salvador
swe.1 | Swedish Allsvenskanliga
swe.1.promotion.relegation | Swedish Allsvenskan Pro/Rel
tha.1 | Thai Premier League
tur.1 | Turkish Super Lig
uefa.champions | UEFA Champions League
uefa.champions_qual | UEFA Champions League Qualifying
uefa.euro | European Championship
uefa.euro_u21 | European Under-21 Championship
uefa.euro_u21_qual | UEFA European Under-21 Championship Qualifying
uefa.euro.u19 | European Under-19 Championship
uefa.europa | UEFA Europa League
uefa.europa_qual | Europa League Qualfiying
uefa.europa.conf | UEFA Europa Conference
uefa.europa.conf_qual | UEFA Conference Qualifying
uefa.euroq | European Championship Qualifying
uefa.nations | UEFA Nations League
uefa.super_cup | UEFA Super Cup
uefa.w.europa | Women's Europa Cup
uefa.w.nations | Women's Nations League
uefa.wchampions | UEFA Women's Champions League
uefa.weuro | UEFA Women's European Championship
uga.1 | Uganda Premier League
uru.1 | Liga AUF Uruguaya
uru.2 | URU2
usa.1 | MLS
usa.ncaa.m.1 | NCAA Men's Soccer
usa.ncaa.w.1 | NCAA Women's Soccer
usa.nwsl | NWSL
usa.nwsl.cup | NWSL Challenge Cup
usa.nwsl.summer.cup | NWSL X Liga MX Femenil Summer Cup
usa.open | U.S. Open Cup
usa.usl.1 | USL Championship
usa.usl.l1 | USL League One
usa.usl.l1.cup | USL Cup
usa.w.usl.1 | USL Super League
ven.1 | Primera División de Venezuela
```

## 6) Catatan penting

- Beberapa code bisa terlihat mirip/duplikat di katalog ESPN (normal).
- Tidak semua league code punya data untuk semua rentang tanggal.
- Selalu test cepat dengan Script 1 setelah tambah liga:

```bash
node script1_fetch_schedule.js
```

Jika dapat `400` untuk liga tertentu, berarti `espn_code` salah/unsupported untuk endpoint scoreboard.

Untuk update hasil berkala (LIVE / FT+10m), lihat `script2_live.js` dan `README_SCRAPER.md`.

