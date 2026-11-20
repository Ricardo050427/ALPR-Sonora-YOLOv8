# Cómo instalar ALPR Sonora en el celular (Android)

La app de Android (`ALPR_Sonora.apk`) hace todo dentro del teléfono: detecta el vehículo con YOLOv8, lee la placa,
estima la velocidad y funciona **sin internet**. Para usar el sistema desde un celular es la opción recomendada:
la versión web de la carpeta `Neflity` corre en el navegador y en un celular es mucho más lenta.

## Requisitos

- Teléfono **Android 7.0 o más nuevo**, con procesador ARM (prácticamente todos los celulares actuales).
- Unos **200 MB libres** (el instalador pesa ~79 MB).
- No funciona en iPhone: la app es solo para Android.

## 1. Descargar el APK

**Opción A, directo en el celular (recomendada):**

1. Abre este enlace en el navegador del celular:
   <https://github.com/Ricardo050427/ALPR-Sonora-YOLOv8/raw/main/ALPR_Sonora.apk>
2. Si Chrome avisa que el archivo puede ser dañino, toca **Descargar de todas formas**.

**Opción B, desde la computadora:** descarga `ALPR_Sonora.apk` del repositorio y pásalo al celular por cable USB,
WhatsApp, Telegram o Google Drive.

## 2. Permitir instalar apps de fuera de Play Store

La primera vez, Android pide permiso para instalar apps descargadas:

1. Abre el archivo descargado (desde la notificación o desde **Archivos › Descargas**).
2. Si aparece *"Por tu seguridad, tu teléfono no puede instalar apps desconocidas de esta fuente"*, toca
   **Configuración** y activa **Permitir de esta fuente**.
3. Regresa con el botón de atrás.

> La ruta exacta cambia según la marca. Normalmente está en **Ajustes › Aplicaciones › Acceso especial ›
> Instalar apps desconocidas**, eligiendo la app con la que abriste el archivo (Chrome, Archivos, WhatsApp, etc.).

## 3. Instalar

1. Toca **Instalar**.
2. Si Google Play Protect muestra *"App no verificada"* o *"Bloqueada por Play Protect"*, toca **Más detalles ›
   Instalar de todas formas**. Aparece porque la app no viene de Play Store, no porque tenga un problema.
3. Si ya tenías una versión anterior y la instalación falla con *"La app no está instalada"*, desinstala la versión
   anterior y vuelve a intentar.

## 4. Primer uso

1. Abre **ALPR Sonora**.
2. Cuando Android pregunte si la app puede usar la cámara, toca **Permitir**. Si lo negaste, la app muestra el
   botón **Conceder permiso** para volver a pedirlo.
3. Apunta la cámara trasera hacia los vehículos.

Lo que vas a ver es igual a la demo del proyecto original:

- **Esquinas verdes** alrededor de cada vehículo detectado.
- **Recuadro rojo** sobre la placa.
- **Cartel blanco** con el número de placa, el recorte real de la placa y, abajo, la **velocidad estimada en km/h**.

Controles:

| Control | Para qué |
| :--- | :--- |
| Pellizcar la pantalla | Zoom de la cámara |
| Botones **1× / 2× / 5×** y barra inferior | Zoom rápido o fino |
| 💡 / 🔦 | Encender o apagar la linterna |
| 📋 | Historial de placas leídas, con su velocidad y hora |

## Consejos para que lea bien las placas

- La placa debe verse de **frente o de espaldas** y ocupar al menos un dedo de ancho en la pantalla. Si se ve
  pequeña, usa el **zoom**.
- Con poca luz, enciende la **linterna** o acércate.
- Para la **velocidad**, mantén el celular **quieto** (apoyado o con tripié). Si el celular se mueve, ese
  movimiento se suma y el número sale más alto.
- La velocidad es una **estimación**: calcula la distancia con el ancho promedio de un auto (1.8 m). En camiones o
  camionetas muy anchas puede variar.

## Problemas comunes

| Problema | Solución |
| :--- | :--- |
| No aparece el botón *Instalar* | Revisa el paso 2 (permitir apps de esta fuente). |
| *"Error al analizar el paquete"* | La descarga se cortó; descarga el APK otra vez. |
| La pantalla de la cámara se queda negra | Cierra la app, revisa en **Ajustes › Apps › ALPR Sonora › Permisos** que la cámara esté permitida y ábrela de nuevo. |
| Detecta autos pero no lee placas | Acércate o usa el zoom; limpia la lente; evita reflejos de sol sobre la placa. |
| Muestra *— km/h* | El vehículo aún no tiene suficiente recorrido, está muy lejos o salió por el borde de la imagen. Espera uno o dos segundos con el vehículo a la vista. |

## Instalar con cable (opcional, para desarrolladores)

Con la **Depuración por USB** activada en el celular y las *platform-tools* de Android en la computadora:

```bash
adb install -r ALPR_Sonora.apk
```
