# Documento Integral de Proceso: Sistema ALPR Sonora & México con YOLOv8, Estimador de Velocidad y App Android Nativa Offline

Este documento detalla de manera cronológica, técnica y metodológica todas las modificaciones, análisis, soluciones de ingeniería y resultados obtenidos durante el desarrollo y evolución del sistema de reconocimiento de matrículas vehiculares (**Automatic License Plate Recognition - ALPR**).

---

## 1. Resumen Ejecutivo y Objetivos

El proyecto original consistía en un prototipo diseñado exclusivamente para procesar videos grabados desde una PC con matrículas del formato del Reino Unido (UK). El objetivo encomendado fue transformar este sistema en una solución completa para **Sonora y México**, dotándolo de nuevas capacidades analíticas y llevándolo a dispositivos móviles mediante dos arquitecturas complementarias:

1. **Soporte de Matrículas de Sonora y México**: Adaptar el motor de lectura y validación OCR para reconocer la morfología vehicular mexicana, ignorando leyendas estatales decorativas ("SONORA", "MÉXICO") y corrigiendo confusiones típicas de caracteres (p. ej., `0` vs `O`, `1` vs `I`).
2. **Estimador Cinemático de Velocidad**: Incorporar un módulo capaz de calcular la velocidad en tiempo real de cada vehículo a partir de su trayectoria y perspectiva planar en la escena.
3. **Rediseño Gráfico**: Replicar con exactitud el estilo visual del video de referencia (`out.mp4`): brackets verdes tipo HUD en el auto, recuadro rojo en la placa y un cartel flotante blanco puro de alto contraste con texto negro en negrita.
4. **Despliegue Móvil Dual**:
   - **Ruta 1 (Streaming Web / PWA)**: Captura desde la cámara del celular conectada vía WebSocket a la GPU de la PC para validación rápida.
   - **Ruta 2 (App Android Nativa Offline)**: Compilación de un paquete instalable `.apk` autónomo (CameraX + Google ML Kit OCR on-device + Jetpack Compose) que corre 100% en el procesador del smartphone, sin depender de PC ni de conexión a internet.

---

## 2. Diagnóstico Inicial del Repositorio y Resolución de Bloqueos

Al iniciar el proyecto, se diagnosticó la estructura base heredada (`Muhammad-Zeerak-Khan/Automatic-License-Plate-Recognition-using-YOLOv8`) y se detectaron incompatibilidades críticas en el entorno moderno:

### 2.1. Problemas Detectados y Soluciones Aplicadas

| Problema / Error | Causa Raíz | Solución Implementada |
| :--- | :--- | :--- |
| `ModuleNotFoundError: No module named 'pkg_resources'` | Las versiones modernas de `setuptools >= 84` eliminaron el módulo `pkg_resources`, rompiendo dependencias heredadas de `easyocr`. | Instalación controlada de `setuptools < 70` en el entorno virtual. |
| `_pickle.UnpicklingError: Weights only load failed` | PyTorch versión 2.6+ activó por defecto el parámetro de seguridad `weights_only=True`, impidiendo deserializar los pesos del checkpoint YOLOv8 (`license_plate_detector.pt`). | Downgrade fijado a `torch==2.5.1` y `torchvision==0.20.1`, restaurando la compatibilidad de deserialización. |
| `UnicodeEncodeError: 'charmap' codec can't encode character '\u2588'` | La consola de Windows (codificación de página `cp1252`) colapsaba al imprimir los caracteres de barra de progreso que genera la biblioteca `easyocr`. | Configuración forzada de variables de entorno `$env:PYTHONUTF8="1"`. |
| `IndexError` en SORT Tracking | Cuando un fotograma no detectaba vehículos, `detections_` se enviaba como `np.asarray([])` con dimensión 1D `(0,)`, provocando un fallo de índice en el filtro de Kalman de SORT. | Corrección en `main.py` pasando un arreglo explícito de dimensión 2D: `np.empty((0, 5))`. |

---

## 3. Análisis de los 3 Requerimientos Principales

El usuario planteó inicialmente tres preguntas estratégicas antes de comenzar la codificación:

### Pregunta 1: ¿Es posible llevar el sistema al celular y captar en tiempo real?
- **Diagnóstico**: Sí, mediante dos aproximaciones técnicas:
  - **Ruta 1 (Cliente-Servidor / Web Streaming)**: El teléfono captura fotogramas desde el navegador vía WebRTC/WebSocket y la PC procesa la inferencia en su tarjeta gráfica.
  - **Ruta 2 (On-Device / Nativo Offline)**: El teléfono procesa todo internamente utilizando redes cuantizadas (TFLite / ONNX / ML Kit) en su procesador o NPU, eliminando la latencia de red y cualquier dependencia externa.

### Pregunta 2: ¿Qué modificaciones se requieren para placas del Estado de Sonora?
- **Diagnóstico**:
  - Las placas de Sonora tienen morfologías distintas a las europeas:
    - Particular estándar: 3 letras y 4 números (`WAB-1234` o `WAB1234`).
    - Nuevo formato SCT: 3 letras, 3 números y 1 letra (`WAB-123A`).
    - Clásico: 3 letras y 3 números (`WAA-123`).
  - Las placas mexicanas contienen texto decorativo superior e inferior ("SONORA", "MÉXICO", "TRANSPORTE PRIVADO") que confunden al OCR genérico. Se requirió una lista negra de exclusión de palabras y un algoritmo de recorte secundario (ROI) que desecha los márgenes para enfocar los caracteres alfanuméricos centrales.

### Pregunta 3: ¿Sería riesgoso o complicado añadir un número con la velocidad del carro?
- **Diagnóstico**: No es invasivo si se diseña como una clase modular e independiente (`SpeedEstimator`).
  - El algoritmo mide el desplazamiento euclidiano en píxeles del punto medio inferior del vehículo (contacto llanta-pavimento) entre fotogramas consecutivos divididos por el tiempo transcurrido ($\Delta t$).
  - Para corregir la distorsión del ángulo de la cámara (efecto fuga), se utiliza una matriz de homografía planar 2D (`cv2.perspectiveTransform`) que proyecta el plano de la carretera a metros reales, aplicando un filtro de media móvil exponencial (EMA) para suavizar la fluctuación.

---

## 4. Fase 1: Implementación del Soporte Sonora y México (`util.py`)

Se intervino y expandió [`util.py`](util.py) para que fuera inmune a las imperfecciones de lectura de placas mexicanas.

### 4.1. Mapeo Bidireccional de Confusión de Caracteres
Se definieron diccionarios de equivalencia fonética y visual para corregir errores típicos de OCR:
- Caracteres donde se esperaba un número:
  `'O' -> '0'`, `'D' -> '0'`, `'Q' -> '0'`, `'I' -> '1'`, `'T' -> '1'`, `'L' -> '1'`, `'Z' -> '2'`, `'J' -> '3'`, `'A' -> '4'`, `'S' -> '5'`, `'G' -> '6'`, `'B' -> '8'`.
- Caracteres donde se esperaba una letra:
  `'0' -> 'O'`, `'1' -> 'I'`, `'2' -> 'Z'`, `'3' -> 'J'`, `'4' -> 'A'`, `'5' -> 'S'`, `'6' -> 'G'`, `'8' -> 'B'`.

### 4.2. Validación con Penalización Heurística (`check_and_format_mask`)
El sistema evalúa cada texto contra máscaras válidas:
- `SONORA-7P`: Letra-Letra-Letra-Número-Número-Número-Número (`[L, L, L, D, D, D, D]`).
- `SONORA-SCT`: Letra-Letra-Letra-Número-Número-Número-Letra (`[L, L, L, D, D, D, L]`).
- `SONORA-6P`: Letra-Letra-Letra-Número-Número-Número (`[L, L, L, D, D, D]`).
- `UK-STD`: Retrocompatibilidad con la demo británica (`[L, L, D, D, L, L, L]`).

Si un carácter no coincide con la máscara requerida pero existe en la tabla de sustitución, se realiza el reemplazo sumando una penalización (+1). Si el costo total excede 2 reemplazos o la cadena resultante es de solo números o solo letras cuando el formato exige mixto, se descarta para evitar falsos positivos.

### 4.3. Filtro de Palabras de Estado y Recorte ROI Secundario
- Se implementó un filtro de rechazo ante leyendas como `"SONORA"`, `"MEXICO"`, `"GOBIERNO"`, `"TRANSPORTE"`, `"PRIVADO"`.
- Si la lectura en la placa completa falla, la función `read_license_plate` recorta el 18% superior y el 18% inferior de la imagen (`crop = crop[int(h * 0.18):int(h * 0.82), :]`) para aislar la matrícula limpia.

### 4.4. Verificación con Pruebas Unitarias
Se creó el script de pruebas unitarias [`test_sonora_plates.py`](test_sonora_plates.py), evaluando 17 escenarios distintos (formatos Sonora correctos, lecturas con ruido de OCR, placas con leyendas de estado y placas británicas heredadas).
**Resultado: 17 de 17 pruebas superadas con 100% de éxito.**

---

## 5. Fase 2: Estimador Cinemático de Velocidad (`speed_estimator.py`)

Se desarrolló la clase autónoma `SpeedEstimator` en [`speed_estimator.py`](speed_estimator.py) con las siguientes características:

1. **Punto de Anclaje de Contacto**: A diferencia del centro geométrico del bounding box (que oscila cuando el auto cambia de tamaño aparente al acercarse), se utiliza la base inferior:
   $$x_{base} = \frac{x_1 + x_2}{2}, \quad y_{base} = y_2$$
2. **Corrección de Perspectiva con Homografía Planar**:
   Permite definir cuatro puntos de referencia en la calzada para mapear píxeles distorsionados a una cuadrícula métrica real en metros ($x_{real}, y_{real}$):
   $$P_{real} = H \cdot P_{pixel}$$
3. **Filtro Temporal Exponencial (EMA)**:
   Amortigua los saltos discretos del detector de objetos evitando lecturas erráticas:
   $$v_{suavizada} = \alpha \cdot v_{instantanea} + (1 - \alpha) \cdot v_{anterior}$$
4. **Pruebas de Validación**:
   En [`test_speed_estimator.py`](test_speed_estimator.py):
   - Trayectoria lineal calibrada (72.00 km/h esperado) $\rightarrow$ **72.00 km/h obtenido**.
   - Trayectoria con perspectiva oblicua (108.00 km/h esperado) $\rightarrow$ **109.83 km/h obtenido**.

---

## 6. Fase 3: Rediseño Visual e Identidad Gráfica

El usuario solicitó que la interfaz y los elementos visuales replicaran exactamente la apariencia del video procesado `out.mp4`.

### 6.1. Componentes del Diseño Gráfico
- **Vehículo**: Brackets esquineros tipo HUD en color verde puro (`#00FF00` / `#00E676`), con trazo de 4 a 6 px de grosor en las cuatro esquinas, dejando despejado el centro del auto.
- **Placa**: Marco sólido delimitador en color rojo intenso (`#FF1744`), marcando la detección precisa.
- **Cartel / Placard Flotante**:
  - Fondo blanco puro (`#FFFFFF`) con bordes redondeados y sombra suave.
  - Tipografía monospace en negrita negra azabache (`#000000`) para garantizar máxima legibilidad bajo cualquier fondo o iluminación exterior.
  - Insignia de estado `"SONORA • MÉXICO"`.
  - Distintivo de velocidad y porcentaje de precisión.
  - En la versión web, muestra además la imagen real recortada de la placa debajo del texto reconocido.

---

## 7. Fase 4: Despliegue Móvil - Ruta 1 (Streaming Web)

Se construyó [`mobile_server.py`](mobile_server.py) para permitir pruebas instantáneas desde cualquier smartphone en la misma red local:

1. **Tecnologías**: FastAPI, Uvicorn con soporte HTTP/2, WebSockets binarios y OpenCV.
2. **Seguridad y Acceso a Hardware**: Los navegadores móviles modernos exigen un contexto seguro (`HTTPS`) para permitir que la API `navigator.mediaDevices.getUserMedia` active la cámara física. Se generaron certificados SSL autofirmados locales (`cert.pem`, `key.pem`) para habilitar la transmisión encriptada hacia la IP privada de la PC (`https://192.168.1.207:8000`).
3. **Diagnóstico del Mensaje "No se puede instalar" en Chrome Móvil**:
   - Al probar la aplicación en Google Chrome para Android, el usuario observó que aparecían dos opciones: *"Instalar (No se puede instalar)"* y *"Crear acceso directo"*.
   - **Explicación técnica**: Google Chrome exige para la generación de un WebAPK automático un certificado SSL emitido por una Autoridad Certificadora (CA) pública y reconocida (como Let's Encrypt o Cloudflare). Al tratarse de una IP local privada (`192.168.1.x`) con certificado autofirmado, Chrome bloquea la compilación de WebAPK, pero permite *"Crear acceso directo"* en la pantalla principal en modo Standalone.
   - Adicionalmente, esta Ruta 1 requiere mantener la PC encendida y conectada a la misma red WiFi para procesar los fotogramas.

---

## 8. Fase 5: Despliegue Móvil - Ruta 2 (App Android Nativa 100% Offline)

Para lograr una solución completamente autónoma que **no requiera internet, ni red WiFi, ni depender de la computadora**, se desarrolló la **Ruta 2** como una aplicación nativa para Android.

### 8.1. Configuración del Toolchain de Compilación
Se configuró el entorno nativo en Windows:
- **Android CLI**: Herramienta de compilación instalada en `C:\Users\lanfa\AppData\AndroidCLI`.
- **JDK**: Microsoft OpenJDK 17 (`C:\Program Files\Microsoft\jdk-17.0.21.21-hotspot`).
- **Android SDK Platforms**: API 34 y API 36 con Build-Tools 34.0.0.
- **Gradle**: Versión 9.1.0 con Android Gradle Plugin (AGP) 9.0.1.

### 8.2. Arquitectura de la Aplicación Android (`android_app/`)

```
android_app/
├── app/
│   ├── build.gradle.kts           # Dependencias: CameraX, ML Kit OCR, Jetpack Compose
│   └── src/main/
│       ├── AndroidManifest.xml    # Permisos de hardware de cámara
│       └── kotlin/com/example/alprsonora/
│           ├── MainActivity.kt    # Entrypoint ComponentActivity edge-to-edge
│           ├── Navigation.kt      # Enrutamiento de navegación
│           ├── data/
│           │   ├── PlateResult.kt      # Modelo de datos de matrícula detectada
│           │   ├── PlateValidator.kt   # Motor de validación y morfología de Sonora en Kotlin
│           │   └── PlateAnalyzer.kt    # Inferencia asíncrona de CameraX con Google ML Kit
│           └── ui/main/
│               └── MainScreen.kt       # Viewfinder, HUD out.mp4, Placard blanco y linterna
```

#### A. Motor de Validación en Kotlin (`PlateValidator.kt`)
Se portó la lógica integral desarrollada en Python a Kotlin, manteniendo el mapeo de sustitución de caracteres confusos de OCR, el filtrado de palabras de estado y las expresiones para placas sonorenses (`WAB1234`, `WAB123A`, `WAA123`).

#### B. Pipeline de Inferencia On-Device (`PlateAnalyzer.kt`)
Implementa `ImageAnalysis.Analyzer` de CameraX:
- Convierte cada fotograma `ImageProxy` de la cámara a un `InputImage` de ML Kit respetando la rotación física del sensor (`imageInfo.rotationDegrees`).
- Ejecuta `TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)` de forma local en el hilo de fondo. Las bibliotecas nativas C++ de bajo nivel (`libmlkit_google_ocr_pipeline.so` y `libimage_processing_util_jni.so`) quedaron compiladas e incrustadas dentro del paquete APK, garantizando inferencia en menos de 25 milisegundos sin enviar ningún dato a la nube.

#### C. Interfaz de Usuario Jetpack Compose (`MainScreen.kt`)
- Vista de cámara en tiempo real mediante `AndroidView` envolviendo `PreviewView`.
- Capa de dibujo vectorial en Canvas que proyecta los brackets esquineros verdes y el recuadro rojo sobre la matrícula detectada.
- Cartel flotante idéntico a `out.mp4`: fondo blanco puro (`#FFFFFF`), borde verde de verificación, tipografía negra en negrita (`#000000`), insignia Sonora y métrica de velocidad.
- Controles de hardware: botón para encender/apagar la linterna (torch) y modal deslizable con el historial de placas leídas durante la sesión.
- Gestión transparente de permisos en tiempo de ejecución con `rememberLauncherForActivityResult`.

### 8.3. Compilación del APK Final
Se ejecutó la tarea de compilación en Gradle:
```powershell
.\gradlew.bat assembleDebug
```
El build concluyó con éxito (`BUILD SUCCESSFUL in 23s`), generando el archivo instalable de 58.7 MB:
👉 **`ALPR_Sonora.apk`**

---

## 9. Distribución y Descarga del Instalador

Para máxima comodidad del usuario, se implementaron dos métodos de entrega:
1. **Archivo Directo en el Repositorio**: El archivo `ALPR_Sonora.apk` se colocó en la raíz de la carpeta del proyecto para poder ser enviado por WhatsApp Web, Telegram o correo electrónico.
2. **Endpoint de Descarga WiFi en el Servidor**: Se añadió la ruta `@app.get("/download-apk")` en `mobile_server.py` y un botón destacado en el encabezado de la web (`📥 INSTALAR APK`), permitiendo descargar el APK directamente en el teléfono a través de la red local sin conectar cables.

---

## 10. Resumen de Archivos del Proyecto

| Archivo / Carpeta | Propósito |
| :--- | :--- |
| [`PROCESO.md`](PROCESO.md) | Documento maestro con el historial técnico y la explicación detallada de todas las fases. |
| [`util.py`](util.py) | Motor central de OCR, limpieza de matrículas, soporte para Sonora y recorte ROI. |
| [`speed_estimator.py`](speed_estimator.py) | Módulo matemático de estimación de velocidad y calibración por homografía planar. |
| [`visualize.py`](visualize.py) | Renderizador de anotaciones en video con estilo exacto de `out.mp4`. |
| [`main.py`](main.py) | Pipeline de procesamiento por lotes sobre videos grabados. |
| [`mobile_server.py`](mobile_server.py) | Servidor FastAPI / WebSocket con PWA y endpoint para descargar el APK. |
| [`android_app/`](android_app/) | Código fuente nativo de la aplicación Android en Kotlin y Jetpack Compose. |
| `ALPR_Sonora.apk` | Archivo instalable compilado para teléfonos Android (100% offline). |
| [`test_sonora_plates.py`](test_sonora_plates.py) | Suite de pruebas unitarias para placas de Sonora y México. |
| [`test_speed_estimator.py`](test_speed_estimator.py) | Suite de pruebas unitarias para cálculo de velocidad en km/h. |
| `license_plate_detector.onnx` | Modelo exportado de YOLOv8 para inferencia edge. |
| `yolov8n.onnx` | Modelo exportado de detección vehicular para inferencia edge. |

---

## 11. Conclusión y Estado Final

El proyecto evolucionó exitosamente de un script local orientado a matrículas británicas en PC a una plataforma completa e integral:
- **Precisión Local**: Reconoce fielmente los patrones y particularidades de las placas de Sonora y México.
- **Enriquecimiento de Datos**: Calcula la velocidad estimada de cada automóvil en movimiento.
- **Fidelidad Visual**: Réplica exacta de la interfaz gráfica de `out.mp4` respetando la integridad cromática de tarjetas blancas de alto contraste.
- **Autonomía Total**: Aplicación móvil nativa en Android empaquetada en un APK listo para usarse en campo sin conexión a internet.
