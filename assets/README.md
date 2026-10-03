# Vendored dashboard assets

| File | Version | License | Size |
| --- | --- | --- | --- |
| `echarts.min.js` | Apache ECharts (existing vendor) | Apache-2.0 | see file |
| `jspdf.umd.min.js` | jsPDF 4.2.1 | MIT | 420165 bytes |
| `jspdf.plugin.autotable.min.js` | jspdf-autotable 5.0.8 | MIT | 32389 bytes |
| `NotoSans-Regular.ttf` | Noto Sans 5.2.8 latin subset (fontsource) | SIL Open Font License 1.1 | 28132 bytes |
| `NotoSans-Bold.ttf` | Noto Sans 5.2.8 latin 700 subset (fontsource) | SIL Open Font License 1.1 | 28208 bytes |

jsPDF and jspdf-autotable are loaded only when Export PDF runs. The Noto Sans files cover Latin-1, the registered-mark sign, and typographic dashes used in the report. They do not include Arabic. Instructor names in the report use `instructor_name_clean`. Comment cells that are Arabic script are replaced with “(Arabic text omitted)”.

Confirmed with `npm view jspdf@4.2.1 version license` and `npm view jspdf-autotable@5.0.8 version license` (both MIT).
