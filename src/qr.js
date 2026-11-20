import qrcode from "qrcode-generator";

export function qrSvg(text, { cellSize = 5, margin = 2 } = {}) {
  const qr = qrcode(0, "M");
  qr.addData(String(text));
  qr.make();
  return qr.createSvgTag({ cellSize, margin, scalable: true });
}
