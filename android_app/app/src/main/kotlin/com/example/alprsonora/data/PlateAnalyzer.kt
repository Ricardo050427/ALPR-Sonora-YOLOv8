package com.example.alprsonora.data

import android.graphics.RectF
import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

class PlateAnalyzer(
    private val onPlateDetected: (PlateResult) -> Unit
) : ImageAnalysis.Analyzer {

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private var isBusy = false

    @OptIn(ExperimentalGetImage::class)
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage == null || isBusy) {
            imageProxy.close()
            return
        }

        isBusy = true
        val rotation = imageProxy.imageInfo.rotationDegrees
        val inputImage = InputImage.fromMediaImage(mediaImage, rotation)

        val imageWidth = if (rotation == 90 || rotation == 270) imageProxy.height else imageProxy.width
        val imageHeight = if (rotation == 90 || rotation == 270) imageProxy.width else imageProxy.height

        recognizer.process(inputImage)
            .addOnSuccessListener { visionText ->
                var foundPlate: PlateResult? = null

                // Search in lines first (most plates are recognized as single lines)
                for (block in visionText.textBlocks) {
                    for (line in block.lines) {
                        val box = line.boundingBox
                        val normBox = if (box != null && imageWidth > 0 && imageHeight > 0) {
                            RectF(
                                box.left.toFloat() / imageWidth,
                                box.top.toFloat() / imageHeight,
                                box.right.toFloat() / imageWidth,
                                box.bottom.toFloat() / imageHeight
                            )
                        } else null

                        val result = PlateValidator.validateAndFormat(line.text, normBox)
                        if (result != null) {
                            foundPlate = result
                            break
                        }
                    }
                    if (foundPlate != null) break
                }

                // If not found in individual lines, check whole blocks
                if (foundPlate == null) {
                    for (block in visionText.textBlocks) {
                        val box = block.boundingBox
                        val normBox = if (box != null && imageWidth > 0 && imageHeight > 0) {
                            RectF(
                                box.left.toFloat() / imageWidth,
                                box.top.toFloat() / imageHeight,
                                box.right.toFloat() / imageWidth,
                                box.bottom.toFloat() / imageHeight
                            )
                        } else null

                        val result = PlateValidator.validateAndFormat(block.text, normBox)
                        if (result != null) {
                            foundPlate = result
                            break
                        }
                    }
                }

                if (foundPlate != null) {
                    onPlateDetected(foundPlate)
                }
            }
            .addOnFailureListener {
                // Silently handle frame failure
            }
            .addOnCompleteListener {
                isBusy = false
                imageProxy.close()
            }
    }
}
