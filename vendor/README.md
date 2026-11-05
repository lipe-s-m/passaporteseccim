# Bibliotecas de terceiros

Copiadas do registro npm em versões fixas e servidas pelo próprio site (sem CDN externo).
Carregadas sob demanda: só quando alguém abre "Meu QR" ou o leitor de QR do painel.

| Arquivo | Pacote | Licença | Integridade (npm `dist.integrity`) |
|---|---|---|---|
| `qrcode-generator-1.4.4.js` | qrcode-generator 1.4.4 (Kazuhiko Arase) | MIT (cabeçalho do arquivo) | `sha512-HM7yY8O2ilqhmULxGMpcHSF1EhJJ9yBj8gvDEuZ6M+KGJ0YY2hKpnXvRD+hZPLrDVck3ExIGhmPtSdcjC+guuw==` |
| `jsqr-1.4.0.js` | jsQR 1.4.0 (`dist/jsQR.js`) | Apache-2.0 (`jsqr-LICENSE.txt`) | `sha512-dxLob7q65Xg2DvstYkRpkYtmKm2sPJ9oFhrhmudT1dZvNFFTlroai3AWSpLey/w5vMcLBXRgOJsbXpdN9HzU/A==` |

O jsQR só é usado quando o navegador não tem o leitor nativo `BarcodeDetector` (por exemplo, Safari no iPhone).
