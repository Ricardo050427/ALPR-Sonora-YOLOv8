package com.example.alprsonora.data

data class PlateResult(
    val rawText: String,
    val formattedPlate: String,
    val plateType: String,
    val confidence: Float,
    val boundingBox: android.graphics.RectF? = null,
    val timestamp: Long = System.currentTimeMillis()
)

object PlateValidator {
    private val CHAR_TO_INT = mapOf(
        'O' to '0', 'D' to '0', 'Q' to '0',
        'I' to '1', 'T' to '1', 'L' to '1',
        'Z' to '2',
        'J' to '3',
        'A' to '4',
        'S' to '5',
        'G' to '6',
        'B' to '8'
    )

    private val INT_TO_CHAR = mapOf(
        '0' to 'O',
        '1' to 'I',
        '2' to 'Z',
        '3' to 'J',
        '4' to 'A',
        '5' to 'S',
        '6' to 'G',
        '8' to 'B'
    )

    private val BLACKLIST_WORDS = listOf(
        "SONORA", "MEXICO", "TRANSPORTE", "PRIVADO", "FRONTERA",
        "ESTADO", "GOBIERNO", "VEHICULO", "AUTOMOVIL", "CAMIONETA",
        "PARTICULAR", "OFICIAL", "NACIONAL", "MX", "USA"
    )

    // Formats:
    // 0: Sonora Standard (3 letters + 4 digits: WAB1234)
    // 1: Sonora SCT Nuevo (3 letters + 3 digits + 1 letter: WAB123A)
    // 2: Sonora Clásico (3 letters + 3 digits: WAA123)
    // 3: UK / Retro (2 letters + 2 digits + 3 letters: CE61VYL)
    private val PATTERNS = listOf(
        Pair("SONORA-7P", listOf(true, true, true, false, false, false, false)),
        Pair("SONORA-SCT", listOf(true, true, true, false, false, false, true)),
        Pair("SONORA-6P", listOf(true, true, true, false, false, false)),
        Pair("UK-STD", listOf(true, true, false, false, true, true, true))
    )

    fun cleanText(raw: String): String {
        return raw.uppercase()
            .replace(Regex("[^A-Z0-9]"), "")
    }

    fun isBlacklisted(raw: String): Boolean {
        val upper = raw.uppercase()
        return BLACKLIST_WORDS.any { upper.contains(it) }
    }

    fun validateAndFormat(raw: String, box: android.graphics.RectF? = null): PlateResult? {
        val clean = cleanText(raw)
        if (clean.length < 6 || clean.length > 8) return null
        if (isBlacklisted(clean)) return null

        // Penalize pure digits or pure letters if pattern requires both
        if (clean.all { it.isDigit() } || clean.all { it.isLetter() }) return null

        var bestPlate: String? = null
        var bestType: String? = null
        var lowestPenalty = Int.MAX_VALUE

        for ((name, mask) in PATTERNS) {
            if (clean.length != mask.size) continue

            var penalty = 0
            val sb = StringBuilder()
            var valid = true

            for (i in mask.indices) {
                val c = clean[i]
                val mustBeLetter = mask[i]

                if (mustBeLetter) {
                    if (c.isLetter()) {
                        sb.append(c)
                    } else if (INT_TO_CHAR.containsKey(c)) {
                        sb.append(INT_TO_CHAR[c])
                        penalty++
                    } else {
                        valid = false
                        break
                    }
                } else {
                    if (c.isDigit()) {
                        sb.append(c)
                    } else if (CHAR_TO_INT.containsKey(c)) {
                        sb.append(CHAR_TO_INT[c])
                        penalty++
                    } else {
                        valid = false
                        break
                    }
                }
            }

            // Max allowed substitutions is 2 to maintain high precision
            if (valid && penalty <= 2 && penalty < lowestPenalty) {
                lowestPenalty = penalty
                bestPlate = sb.toString()
                bestType = name
            }
        }

        if (bestPlate != null && bestType != null) {
            val formatted = when (bestPlate.length) {
                7 -> "${bestPlate.substring(0, 3)}-${bestPlate.substring(3)}"
                6 -> "${bestPlate.substring(0, 3)}-${bestPlate.substring(3)}"
                else -> bestPlate
            }
            val conf = 1.0f - (lowestPenalty * 0.12f)
            return PlateResult(
                rawText = clean,
                formattedPlate = formatted,
                plateType = bestType,
                confidence = conf,
                boundingBox = box
            )
        }

        return null
    }
}
