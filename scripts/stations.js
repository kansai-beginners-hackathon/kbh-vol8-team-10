// 京都市営地下鉄の駅と時刻表ページの対応表

export const LINES = [
  {
    lineId: "karasuma",
    lineName: "烏丸線",
    stations: [
      { seq: 1, stationId: "kokusaikaikan", name: "国際会館", up: null, down: "021100" },
      { seq: 2, stationId: "matsugasaki", name: "松ヶ崎", up: "021201", down: "021200" },
      { seq: 3, stationId: "kitayama", name: "北山", up: "021301", down: "021300" },
      { seq: 4, stationId: "kitaoji", name: "北大路", up: "021401", down: "021400" },
      { seq: 5, stationId: "kuramaguchi", name: "鞍馬口", up: "021501", down: "021500" },
      { seq: 6, stationId: "imadegawa", name: "今出川", up: "021601", down: "021600" },
      { seq: 7, stationId: "marutamachi", name: "丸太町", up: "021701", down: "021700" },
      { seq: 8, stationId: "karasuma-oike", name: "烏丸御池", up: "021801", down: "021800" },
      { seq: 9, stationId: "shijo", name: "四条", up: "021901", down: "021900" },
      { seq: 10, stationId: "gojo", name: "五条", up: "022001", down: "022000" },
      { seq: 11, stationId: "kyoto", name: "京都", up: "022101", down: "022100" },
      { seq: 12, stationId: "kujo", name: "九条", up: "022201", down: "022200" },
      { seq: 13, stationId: "jujo", name: "十条", up: "022301", down: "022300" },
      { seq: 14, stationId: "kuinabashi", name: "くいな橋", up: "022401", down: "022400" },
      { seq: 15, stationId: "takeda", name: "竹田", up: "022501", down: "022500" },
    ],
  },
  {
    lineId: "tozai",
    lineName: "東西線",
    stations: [
      { seq: 1, stationId: "rokujizo", name: "六地蔵", up: null, down: "012300" },
      { seq: 2, stationId: "ishida", name: "石田", up: "012401", down: "012400" },
      { seq: 3, stationId: "daigo", name: "醍醐", up: "012501", down: "012500" },
      { seq: 4, stationId: "ono", name: "小野", up: "012601", down: "012600" },
      { seq: 5, stationId: "nagitsuji", name: "椥辻", up: "012701", down: "012700" },
      { seq: 6, stationId: "higashino", name: "東野", up: "012801", down: "012800" },
      { seq: 7, stationId: "yamashina", name: "山科", up: "012901", down: "012900" },
      { seq: 8, stationId: "misasagi", name: "御陵", up: "013001", down: "013000" },
      { seq: 9, stationId: "keage", name: "蹴上", up: "013101", down: "013100" },
      { seq: 10, stationId: "higashiyama", name: "東山", up: "013201", down: "013200" },
      { seq: 11, stationId: "sanjo-keihan", name: "三条京阪", up: "013301", down: "013300" },
      { seq: 12, stationId: "kyotoshiyakushomae", name: "京都市役所前", up: "013401", down: "013400" },
      { seq: 13, stationId: "karasuma-oike", name: "烏丸御池", up: "013501", down: "013500" },
      { seq: 14, stationId: "nijojomae", name: "二条城前", up: "013601", down: "013600" },
      { seq: 15, stationId: "nijo", name: "二条", up: "013701", down: "013700" },
      { seq: 16, stationId: "nishioji-oike", name: "西大路御池", up: "013801", down: "013800" },
      { seq: 17, stationId: "uzumasa-tenjingawa", name: "太秦天神川", up: "013901", down: null },
    ],
  },
];

export const BASE_URL = "https://www2.city.kyoto.lg.jp/kotsu/tikadia/hyperdia/";