import type { FormMark, RawMatch, Side } from "@/data/weekend";

function side(name: string, short: string, pos: number, form: FormMark[], xgFor: number, xgAgainst: number): Side {
  return { name, short, pos, form, xgFor, xgAgainst, gf: Math.round(xgFor * 10), ga: Math.round(xgAgainst * 10), played: 10, out: [] };
}

function game(
  id: string,
  league: string,
  code: RawMatch["code"],
  day: RawMatch["day"],
  dateLabel: string,
  time: string,
  venue: string,
  home: Side,
  away: Side,
): RawMatch {
  return { id, league, code, day, dateLabel, time, venue, home, away };
}

const W: FormMark[] = ["W", "W", "D", "W", "W"];
const M: FormMark[] = ["W", "D", "L", "W", "D"];
const L: FormMark[] = ["L", "D", "W", "L", "D"];

export const REST_MATCHES: RawMatch[] = [
  game("epl-whu-bri", "Premier League", "EPL", "Sunday", "Sun 8 Nov", "14:00", "London Stadium", side("West Ham", "West Ham", 14, M, 1.24, 1.48), side("Brighton", "Brighton", 6, W, 1.62, 1.12)),
  game("epl-cry-nfo", "Premier League", "EPL", "Saturday", "Sat 7 Nov", "15:00", "Selhurst Park", side("Crystal Palace", "Palace", 11, M, 1.28, 1.26), side("Nottingham Forest", "Forest", 10, M, 1.36, 1.22)),
  game("ucl-atm-psv", "Champions League", "UCL", "Midweek", "Tue 10 Nov", "20:00", "Metropolitano", side("Atletico Madrid", "Atletico", 4, W, 1.52, 0.9), side("PSV", "PSV", 1, W, 1.84, 1.02)),
  game("ucl-juv-ben", "Champions League", "UCL", "Midweek", "Wed 11 Nov", "20:00", "Allianz Stadium", side("Juventus", "Juventus", 5, M, 1.46, 1.02), side("Benfica", "Benfica", 1, W, 1.78, 0.86)),
  game("uel-lyo-rom", "Europa League", "UEL", "Midweek", "Thu 12 Nov", "20:00", "Groupama Stadium", side("Lyon", "Lyon", 6, M, 1.48, 1.18), side("Roma", "Roma", 4, W, 1.56, 1.04)),
  game("uel-cel-aja", "Europa League", "UEL", "Midweek", "Thu 12 Nov", "20:00", "Celtic Park", side("Celtic", "Celtic", 1, W, 1.92, 0.78), side("Ajax", "Ajax", 2, W, 1.74, 1.08)),
  game("lal-sev-bet", "La Liga", "LAL", "Saturday", "Sat 7 Nov", "17:30", "Ramon Sanchez-Pizjuan", side("Sevilla", "Sevilla", 12, L, 1.22, 1.34), side("Real Betis", "Betis", 8, M, 1.4, 1.16)),
  game("lal-soc-vil", "La Liga", "LAL", "Sunday", "Sun 8 Nov", "13:00", "Reale Arena", side("Real Sociedad", "Sociedad", 6, M, 1.46, 1.08), side("Villarreal", "Villarreal", 5, W, 1.58, 1.12)),
  game("sea-udi-bol", "Serie A", "SEA", "Sunday", "Sun 8 Nov", "14:00", "Bluenergy Stadium", side("Udinese", "Udinese", 11, L, 1.16, 1.32), side("Bologna", "Bologna", 7, M, 1.38, 1.08)),
  game("sea-cag-ver", "Serie A", "SEA", "Saturday", "Sat 7 Nov", "17:00", "Unipol Domus", side("Cagliari", "Cagliari", 14, L, 1.08, 1.4), side("Verona", "Verona", 16, L, 1.02, 1.48)),
  game("bun-uni-hof", "Bundesliga", "BUN", "Saturday", "Sat 7 Nov", "15:30", "Altes Stadion", side("Union Berlin", "Union", 9, M, 1.28, 1.18), side("Hoffenheim", "Hoffenheim", 8, M, 1.52, 1.36)),
  game("bun-wob-aug", "Bundesliga", "BUN", "Sunday", "Sun 8 Nov", "16:30", "Volkswagen Arena", side("Wolfsburg", "Wolfsburg", 10, L, 1.34, 1.28), side("Augsburg", "Augsburg", 13, L, 1.18, 1.42)),
  game("fra-ren-len", "Ligue 1", "FRA", "Sunday", "Sun 8 Nov", "16:00", "Roazhon Park", side("Rennes", "Rennes", 7, M, 1.44, 1.16), side("Lens", "Lens", 5, W, 1.5, 1.04)),
  game("fra-nan-str", "Ligue 1", "FRA", "Saturday", "Sat 7 Nov", "18:00", "La Beaujoire", side("Nantes", "Nantes", 12, L, 1.12, 1.36), side("Strasbourg", "Strasbourg", 9, M, 1.3, 1.22)),
  game("ere-az-twe", "Eredivisie", "ERE", "Sunday", "Sun 8 Nov", "13:30", "AFAS Stadion", side("AZ", "AZ", 5, M, 1.52, 1.14), side("Twente", "Twente", 4, W, 1.58, 1.1)),
  game("ere-hee-spa", "Eredivisie", "ERE", "Saturday", "Sat 7 Nov", "19:00", "Abe Lenstra", side("Heerenveen", "Heerenveen", 8, L, 1.28, 1.3), side("Sparta", "Sparta", 9, M, 1.22, 1.26)),
  game("por-bra-gui", "Primeira Liga", "POR", "Sunday", "Sun 8 Nov", "17:30", "Estadio Municipal", side("Braga", "Braga", 4, W, 1.56, 1.02), side("Guimaraes", "Guimaraes", 6, M, 1.32, 1.14)),
  game("por-fam-spo", "Primeira Liga", "POR", "Saturday", "Sat 7 Nov", "20:30", "Estadio Municipal 22 de Junho", side("Famalicao", "Famalicao", 8, L, 1.18, 1.24), side("Sporting", "Sporting", 3, W, 1.84, 0.9)),
  game("chp-cov-wat", "Championship", "CHP", "Saturday", "Sat 7 Nov", "15:00", "CBS Arena", side("Coventry", "Coventry", 2, W, 1.62, 0.98), side("Watford", "Watford", 8, M, 1.34, 1.18)),
  game("chp-swa-lee", "Championship", "CHP", "Sunday", "Sun 8 Nov", "15:00", "Swansea.com Stadium", side("Swansea", "Swansea", 10, M, 1.28, 1.16), side("Leeds", "Leeds", 7, M, 1.4, 1.12)),
  game("spl-hib-abe", "Scottish Premiership", "SPL", "Sunday", "Sun 8 Nov", "14:00", "Easter Road", side("Hibernian", "Hibs", 5, M, 1.36, 1.14), side("Aberdeen", "Aberdeen", 4, M, 1.4, 1.1)),
  game("spl-kil-dun", "Scottish Premiership", "SPL", "Saturday", "Sat 7 Nov", "15:00", "Rugby Park", side("Kilmarnock", "Kilmarnock", 8, L, 1.12, 1.28), side("Dundee", "Dundee", 10, L, 1.04, 1.36)),
  game("mls-sea-por", "MLS", "MLS", "Saturday", "Sat 7 Nov", "21:30", "Lumen Field", side("Seattle Sounders", "Seattle", 5, M, 1.48, 1.12), side("Portland Timbers", "Portland", 8, L, 1.26, 1.3)),
  game("mex-pach-tol", "Liga MX", "MEX", "Sunday", "Sun 8 Nov", "02:00", "Hidalgo", side("Pachuca", "Pachuca", 6, M, 1.42, 1.08), side("Toluca", "Toluca", 4, W, 1.54, 1.02)),
  game("bra-int-san", "Brasileirao", "BRA", "Sunday", "Sun 8 Nov", "22:00", "Beira-Rio", side("Internacional", "Inter", 5, M, 1.46, 1.06), side("Santos", "Santos", 12, L, 1.18, 1.32)),
  game("arg-riv-est", "Liga Profesional", "ARG", "Saturday", "Sat 7 Nov", "21:00", "Mas Monumental", side("River Plate", "River", 1, W, 1.72, 0.84), side("Estudiantes", "Estudiantes", 5, M, 1.3, 1.04)),
  game("tur-gs-bes", "Super Lig", "TUR", "Sunday", "Sun 8 Nov", "17:00", "Rams Park", side("Galatasaray", "Galatasaray", 1, W, 1.96, 0.8), side("Besiktas", "Besiktas", 3, M, 1.5, 1.06)),
  game("bel-genk-bru", "Pro League", "BEL", "Saturday", "Sat 7 Nov", "19:45", "Cegeka Arena", side("Genk", "Genk", 2, W, 1.58, 1.0), side("Club Brugge", "Brugge", 1, W, 1.7, 0.92)),
  game("gre-aek-oly", "Super League", "GRE", "Sunday", "Sun 8 Nov", "18:30", "OPAP Arena", side("AEK Athens", "AEK", 4, M, 1.48, 1.02), side("Olympiacos", "Olympiacos", 1, W, 1.66, 0.86)),
  game("aut-stu-rap", "Bundesliga", "AUT", "Sunday", "Sun 8 Nov", "16:00", "Merkur Arena", side("Sturm Graz", "Sturm", 2, W, 1.6, 0.94), side("Rapid Wien", "Rapid", 4, M, 1.36, 1.12)),
  game("sui-bas-ser", "Super League", "SUI", "Saturday", "Sat 7 Nov", "17:00", "St Jakob-Park", side("Basel", "Basel", 2, W, 1.54, 0.98), side("Servette", "Servette", 4, M, 1.32, 1.1)),
  game("sau-nsr-ahl", "Saudi Pro League", "SAU", "Saturday", "Sat 7 Nov", "17:00", "Al-Awwal Park", side("Al Nassr", "Al Nassr", 2, W, 1.88, 0.9), side("Al Ahli", "Al Ahli", 4, M, 1.46, 1.04)),
  game("j1-ura-kob", "J.League", "J1", "Sunday", "Sun 8 Nov", "06:00", "Saitama Stadium", side("Urawa Reds", "Urawa", 5, M, 1.4, 1.08), side("Vissel Kobe", "Kobe", 1, W, 1.62, 0.88)),
  game("ken-gor-tus", "Kenyan Premier League", "KEN", "Sunday", "Sun 8 Nov", "15:00", "Kasarani", side("Gor Mahia", "Gor", 1, W, 1.5, 0.84), side("Tusker", "Tusker", 3, M, 1.28, 1.06)),
  game("ken-leo-sof", "Kenyan Premier League", "KEN", "Saturday", "Sat 7 Nov", "15:00", "Nyayo", side("AFC Leopards", "Leopards", 4, M, 1.22, 1.12), side("Sofapaka", "Sofapaka", 9, L, 1.04, 1.3)),
  game("nga-eny-rem", "NPFL", "NGA", "Sunday", "Sun 8 Nov", "16:00", "Enyimba Stadium", side("Enyimba", "Enyimba", 2, W, 1.4, 0.98), side("Remo Stars", "Remo", 1, W, 1.48, 0.92)),
  game("rsa-orl-kcz", "Premier Soccer League", "RSA", "Saturday", "Sat 7 Nov", "15:00", "Orlando Stadium", side("Orlando Pirates", "Pirates", 2, W, 1.52, 0.9), side("Kaizer Chiefs", "Chiefs", 6, M, 1.24, 1.14)),
  game("egy-zam-pyr", "Egyptian Premier League", "EGY", "Sunday", "Sun 8 Nov", "18:00", "Cairo Stadium", side("Zamalek", "Zamalek", 2, W, 1.46, 0.88), side("Pyramids", "Pyramids", 3, W, 1.5, 0.96)),
  game("sud-bol-ldu", "Copa Sudamericana", "SUD", "Midweek", "Thu 12 Nov", "00:30", "Hernando Siles", side("Bolivar", "Bolivar", 3, M, 1.42, 1.04), side("LDU Quito", "LDU", 2, W, 1.5, 0.98)),
  game("b2-fck-hsv", "2. Bundesliga", "B2", "Saturday", "Sat 7 Nov", "12:00", "Fritz-Walter-Stadion", side("Kaiserslautern", "Lautern", 5, M, 1.38, 1.16), side("Hamburger SV", "Hamburg", 2, W, 1.56, 1.02)),
  game("l1-wre-bol", "League One", "L1", "Saturday", "Sat 7 Nov", "15:00", "Racecourse Ground", side("Wrexham", "Wrexham", 3, W, 1.54, 1.06), side("Bolton", "Bolton", 4, M, 1.42, 1.1)),
  game("sud-nac-pen", "Copa Sudamericana", "SUD", "Midweek", "Thu 12 Nov", "23:00", "Gran Parque Central", side("Nacional", "Nacional", 2, M, 1.4, 1.0), side("Penarol", "Penarol", 1, W, 1.52, 0.94)),
  game("b2-s04-bsc", "2. Bundesliga", "B2", "Sunday", "Sun 8 Nov", "12:30", "Veltins-Arena", side("Schalke", "Schalke", 6, M, 1.36, 1.2), side("Hertha Berlin", "Hertha", 8, L, 1.26, 1.24)),
  game("l1-sto-bir", "League One", "L1", "Sunday", "Sun 8 Nov", "15:00", "Edgeley Park", side("Stockport", "Stockport", 2, W, 1.58, 1.0), side("Birmingham", "Birmingham", 1, W, 1.64, 0.96)),
  game("mls-nyc-atl", "MLS", "MLS", "Sunday", "Sun 8 Nov", "19:00", "Yankee Stadium", side("New York City", "NYCFC", 6, M, 1.4, 1.16), side("Atlanta United", "Atlanta", 9, L, 1.28, 1.3)),
  game("mex-leo-san", "Liga MX", "MEX", "Saturday", "Sat 7 Nov", "23:00", "Nou Camp", side("Leon", "Leon", 7, M, 1.36, 1.1), side("Santos Laguna", "Santos", 12, L, 1.12, 1.34)),
  game("bra-fla-san", "Brasileirao", "BRA", "Saturday", "Sat 7 Nov", "20:00", "Maracana", side("Fluminense", "Fluminense", 6, M, 1.38, 1.12), side("Sao Paulo", "Sao Paulo", 7, M, 1.34, 1.14)),
  game("arg-boc-rac", "Liga Profesional", "ARG", "Sunday", "Sun 8 Nov", "20:00", "La Bombonera", side("Boca Juniors", "Boca", 3, M, 1.48, 0.98), side("Racing", "Racing", 2, W, 1.5, 0.96)),
  game("tur-fen-tra", "Super Lig", "TUR", "Saturday", "Sat 7 Nov", "17:00", "Sukru Saracoglu", side("Fenerbahce", "Fenerbahce", 2, W, 1.78, 0.9), side("Trabzonspor", "Trabzonspor", 5, M, 1.36, 1.14)),
  game("bel-ant-and", "Pro League", "BEL", "Sunday", "Sun 8 Nov", "13:30", "Bosuil", side("Antwerp", "Antwerp", 6, M, 1.32, 1.18), side("Anderlecht", "Anderlecht", 3, W, 1.5, 1.04)),
  game("gre-pao-paok", "Super League", "GRE", "Saturday", "Sat 7 Nov", "18:00", "OAKA", side("Panathinaikos", "Panathinaikos", 2, W, 1.56, 0.96), side("PAOK", "PAOK", 3, M, 1.52, 0.98)),
  game("aut-sal-wac", "Bundesliga", "AUT", "Saturday", "Sat 7 Nov", "16:00", "Red Bull Arena", side("Red Bull Salzburg", "Salzburg", 1, W, 1.96, 0.78), side("Austria Wien", "Austria Wien", 6, L, 1.22, 1.2)),
  game("sui-yb-zur", "Super League", "SUI", "Sunday", "Sun 8 Nov", "15:30", "Wankdorf", side("Young Boys", "Young Boys", 1, W, 1.74, 0.9), side("Zurich", "Zurich", 5, L, 1.26, 1.18)),
  game("sau-hil-itt", "Saudi Pro League", "SAU", "Saturday", "Sat 7 Nov", "17:00", "Kingdom Arena", side("Al Hilal", "Al Hilal", 1, W, 2.1, 0.74), side("Al Ittihad", "Al Ittihad", 3, M, 1.58, 1.0)),
  game("j1-kas-yfm", "J.League", "J1", "Saturday", "Sat 7 Nov", "06:00", "Kashima Stadium", side("Kashima Antlers", "Kashima", 3, M, 1.48, 0.98), side("Yokohama F. Marinos", "Marinos", 4, M, 1.44, 1.08)),
  game("nga-ran-rvs", "NPFL", "NGA", "Saturday", "Sat 7 Nov", "15:00", "Cathedral", side("Rangers International", "Rangers", 5, M, 1.22, 1.1), side("Rivers United", "Rivers", 3, W, 1.3, 1.02)),
  game("rsa-sun-ste", "Premier Soccer League", "RSA", "Sunday", "Sun 8 Nov", "13:30", "Loftus Versfeld", side("Mamelodi Sundowns", "Sundowns", 1, W, 2.02, 0.72), side("Stellenbosch", "Stellenbosch", 3, W, 1.34, 1.04)),
  game("egy-ahl-fut", "Egyptian Premier League", "EGY", "Saturday", "Sat 7 Nov", "18:00", "Cairo Stadium", side("Al Ahly", "Ahly", 1, W, 1.9, 0.7), side("Modern Future", "Future", 7, L, 1.14, 1.22)),
];
