# ALPR Sonora · versión web (Netlify)

Versión del sistema que corre **completa en el navegador**: no necesita servidor, PC ni Python.

| Pieza | En Python (`main.py` / `util.py`) | En la web |
| :--- | :--- | :--- |
| Detección de vehículos | `yolov8n.pt` (clases 2, 3, 5, 7) | `models/yolov8n.onnx` con onnxruntime-web (WASM) |
| Detección de placas | `license_plate_detector.pt` | `models/license_plate_detector.onnx` |
| Seguimiento | SORT | `js/tracker.js` (seguimiento por IoU) |
| OCR | EasyOCR | Tesseract.js (`js/ocr.js`) |
| Reglas de placas | `util.py` | `js/plates.js` (mismas máscaras, diccionarios y límite de 2 correcciones) |
| Velocidad | `speed_estimator.py` (homografía) | `js/speed.js` (tamaño aparente del vehículo + campo de visión) |
| Interfaz | `visualize.py` | esquinas verdes, recuadro rojo, cartel blanco con la placa y el recorte, más la velocidad |

Funciones: cámara trasera del celular, **zoom** (botones 1×/2×/4×, barra, pellizco o rueda del mouse;
usa el zoom óptico de la cámara cuando el navegador lo permite y si no, zoom digital), linterna,
abrir un video del dispositivo, demo incluida, historial con exportación a CSV y funcionamiento sin conexión
después de la primera visita (PWA).

## Publicar en Netlify

**Opción A, arrastrar y soltar:** entra a <https://app.netlify.com/drop> y suelta la carpeta `Neflity/` completa.

**Opción B, desde GitHub:** conecta el repositorio en Netlify y en **Base directory** escribe `Neflity`. El `netlify.toml`
de esta carpeta indica que no hay comando de build.

El archivo `_headers` activa `Cross-Origin-Opener-Policy` y `Cross-Origin-Embedder-Policy`; con eso el navegador
permite varios hilos de WASM y la detección es varias veces más rápida. La cámara necesita HTTPS, que Netlify
ya da.

## Probar en local

Cualquier servidor estático sirve, pero sin los encabezados de `_headers` corre con un solo hilo:

```bash
npx serve Neflity
```

## Sobre la velocidad

Un celular no tiene la calle calibrada, así que la distancia a cada vehículo se calcula con el modelo de cámara
estenopeica: `Z = fx · 1.8 m / ancho_px`, donde `fx` sale del campo de visión horizontal y del zoom. La velocidad
es la pendiente (regresión) de la posición en metros durante 1.5 s, suavizada con EMA α = 0.3, igual que
`speed_estimator.py`. En **Ajustes** se puede corregir el campo de visión y el ancho promedio del vehículo. Es una
estimación: funciona mejor con la cámara fija y vehículos de frente o de espaldas.
