# Automatic-Number-Plate-Recognition-YOLOv8 (Sonora & México Edition)

> 📖 **[Ver Documento Completo del Proceso y Modificaciones (PROCESO.md)](PROCESO.md)**  
> 📱 **[Descargar App Android Offline (.apk)](ALPR_Sonora.apk)**

Sistema integral de reconocimiento automático de matrículas para Sonora y México con YOLOv8, estimador de velocidad vehicular cinemático y aplicación móvil nativa offline.

### 🌟 Nuevas Características Integradas:
1. **Soporte Placas de Sonora y México**: Reconocimiento de formatos `WAB1234`, `WAB123A`, `WAA123` y sanitización de caracteres confusos de OCR (`0/O`, `1/I`, etc.).
2. **Estimador de Velocidad (`speed_estimator.py`)**: Cálculo de velocidad en km/h mediante homografía planar 2D y filtrado exponencial EMA.
3. **Estilo Gráfico Avanzado (`out.mp4`)**: Brackets esquineros verdes, recuadro rojo en placa y pancarta flotante blanca con texto negro en negrita.
4. **App Android Nativa 100% Offline (`android_app/`)**: Aplicación compilada en Jetpack Compose con CameraX y Google ML Kit OCR local (`ALPR_Sonora.apk`), funcionando sin internet ni PC.
5. **Servidor Móvil Web (`mobile_server.py`)**: Servidor streaming PWA con FastAPI y WebSockets.

---

## Demo Original


https://github.com/Muhammad-Zeerak-Khan/Automatic-License-Plate-Recognition-using-YOLOv8/assets/79400407/1af57131-3ada-470a-b798-95fff00254e6



## Data

The video used in the tutorial can be downloaded [here](https://drive.google.com/file/d/1JbwLyqpFCXmftaJY1oap8Sa6KfjoWJta/view?usp=sharing).

## Model

A Yolov8 pre-trained model (YOLOv8n) was used to detect vehicles.

A licensed plate detector was used to detect license plates. The model was trained with Yolov8 using [this dataset](https://universe.roboflow.com/roboflow-universe-projects/license-plate-recognition-rxg4e/dataset/4). 
- The model is available [here](https://drive.google.com/file/d/1Zmf5ynaTFhmln2z7Qvv-tgjkWQYQ9Zdw/view?usp=sharing).

## Dependencies

The sort module needs to be downloaded from [this repository](https://github.com/abewley/sort).

```bash
git clone https://github.com/abewley/sort
```

## Project Setup

* Make an environment with python=3.10 using the following command 
``` bash
conda create --prefix ./env python==3.10 -y
```
* Activate the environment
``` bash
source activate ./env
``` 

* Install the project dependencies using the following command 
```bash
pip install -r requirements.txt
```
* Run main.py with the sample video file to generate the test.csv file 
``` python
python main.py
```
* Run the add_missing_data.py file for interpolation of values to match up for the missing frames and smooth output.
```python
python add_missing_data.py
```

* Finally run the visualize.py passing in the interpolated csv files and hence obtaining a smooth output for license plate detection.
```python
python visualize.py
```
