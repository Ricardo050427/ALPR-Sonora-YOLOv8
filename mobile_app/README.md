# ALPR Sonora Mobile App (Ruta 2 - Offline Nativo)

Esta aplicación móvil está diseñada para ejecutarse 100% en el procesador de tu celular, sin internet ni computadoras externas.

## Características:
- **Cámara en tiempo real**: Transmisión fluida con `camera`.
- **Motor OCR Ultra Rápido**: Integrado con **Google ML Kit Text Recognition** (<20 ms en NPU).
- **Filtro de Sonora y México**: Identifica formatos `WAB1234`, `WAB123A`, `WAA123` y descarta texto decorativo (`SONORA`, `MEXICO`).
- **Diseño visual idéntico a `out.mp4`**:
  - Esquinas verdes HUD alrededor del vehículo.
  - Recuadro rojo sobre la matrícula.
  - Cartel flotante blanco con texto en negrita negra.

---

## Indicaciones para Compilar en tu Celular

### 1. Instalar Flutter SDK (solo una vez)
En PowerShell como administrador ejecuta:
```powershell
winget install Google.Flutter
```
*(O descárgalo directamente desde [flutter.dev](https://flutter.dev/docs/get-started/install/windows)).*

### 2. Conectar tu Teléfono
1. En tu teléfono Android, ve a **Ajustes > Acerca del teléfono** y pulsa 7 veces en **"Número de compilación"** para activar las *Opciones de desarrollador*.
2. Entra a **Opciones de desarrollador** y activa **"Depuración por USB"**.
3. Conecta el celular a tu PC mediante cable USB y acepta el mensaje de permitir depuración.

### 3. Ejecutar la App en tu Celular
Abre PowerShell dentro de la carpeta `mobile_app`:
```powershell
cd mobile_app
flutter pub get
flutter run
```

### 4. Generar el archivo instalador (.APK)
Para generar el archivo que puedes pasar por WhatsApp o instalar en cualquier Android:
```powershell
flutter build apk --release
```
El instalador se generará en:
`mobile_app/build/app/outputs/flutter-apk/app-release.apk`
