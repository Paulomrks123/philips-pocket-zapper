package br.com.philips.pocketzapper

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.hardware.ConsumerIrManager
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.ServerSocket
import java.net.InetAddress
import java.net.Socket
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.io.InputStream
import java.io.OutputStream
import java.nio.charset.StandardCharsets

class MainActivity : Activity() {
    // No Philips 50PUG6654/78 IR capture has been validated yet.
    // Keep this map empty: never transmit guessed RC5/RC6 codes as if verified.
    private val commands = emptyMap<String, Int>()
    @Volatile private var rc6Toggle = false
    private var ir: ConsumerIrManager? = null
    @Volatile private var tvHost: String? = null
    @Volatile private var tvApiVersion: Int = 6
    private lateinit var webView: WebView
    @Volatile private var localServer: ServerSocket? = null
    @Volatile private var serverRunning = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ir = getSystemService(Context.CONSUMER_IR_SERVICE) as? ConsumerIrManager
        val saved = getSharedPreferences("philips_remote", Context.MODE_PRIVATE)
        // Keep the RC6 toggle across process restarts so the TV does not reject
        // the next POWER frame as a duplicate of the previous press.
        rc6Toggle = saved.getBoolean("rc6_toggle", false)
        tvHost = saved.getString("tv_ip", null)
        tvApiVersion = saved.getInt("tv_api_version", 5)
        startLocalBridgeServer()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    !isTrustedUrl(request.url)

                @Suppress("DEPRECATION")
                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                    !isTrustedUrl(Uri.parse(url))
            }
            webChromeClient = WebChromeClient()
            addJavascriptInterface(IrBridge(), "PhilipsIR")
        }
        setContentView(webView)
        webView.loadUrl(APP_URL)
        checkForAppUpdates()
    }

    private fun checkForAppUpdates() {
        Thread({
            var connection: HttpURLConnection? = null
            try {
                connection = URL("https://api.github.com/repos/Paulomrks123/philips-pocket-zapper/releases/latest")
                    .openConnection() as HttpURLConnection
                connection.requestMethod = "GET"
                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                connection.setRequestProperty("Accept", "application/vnd.github+json")
                connection.setRequestProperty("User-Agent", "Philips-Pocket-Zapper-Android")
                if (connection.responseCode !in 200..299) return@Thread
                val release = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                val tag = release.optString("tag_name")
                val latestCode = Regex("""v?(\d+)""").matchEntire(tag)
                    ?.groupValues?.getOrNull(1)?.toIntOrNull() ?: return@Thread
                val currentCode = packageManager.getPackageInfo(packageName, 0).versionCode
                if (latestCode <= currentCode) return@Thread
                val assets = release.optJSONArray("assets") ?: return@Thread
                var apkUrl: String? = null
                for (index in 0 until assets.length()) {
                    val asset = assets.optJSONObject(index) ?: continue
                    if (asset.optString("name").endsWith(".apk", ignoreCase = true)) {
                        apkUrl = asset.optString("browser_download_url").takeIf { it.startsWith("https://") }
                        break
                    }
                }
                val downloadUrl = apkUrl ?: release.optString("html_url").takeIf { it.startsWith("https://") }
                    ?: return@Thread
                runOnUiThread {
                    AlertDialog.Builder(this)
                        .setTitle("Atualização disponível")
                        .setMessage("A versão $tag do Philips Pocket Zapper está disponível. Deseja abrir o download?")
                        .setNegativeButton("Depois", null)
                        .setPositiveButton("Baixar atualização") { _, _ ->
                            try {
                                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl)))
                            } catch (_: Exception) {
                                AlertDialog.Builder(this)
                                    .setMessage("Não foi possível abrir o download. Acesse a página de versões do projeto no GitHub.")
                                    .setPositiveButton("OK", null)
                                    .show()
                            }
                        }
                        .show()
                }
            } catch (_: Exception) {
                // Update checks are optional; the remote control remains available offline.
            } finally {
                connection?.disconnect()
            }
        }, "philips-app-update-check").start()
    }

    // Physical volume keys work while this Android companion is in the foreground.
    // Android does not let a background app intercept keys owned by Chrome.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_VOLUME_UP -> { Thread { IrBridge().send("VOLUME_UP") }.start(); return true }
                KeyEvent.KEYCODE_VOLUME_DOWN -> { Thread { IrBridge().send("VOLUME_DOWN") }.start(); return true }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onDestroy() {
        serverRunning = false
        try { localServer?.close() } catch (_: Exception) { }
        localServer = null
        super.onDestroy()
    }

    // Local companion bridge for the PWA opened separately in Chrome.
    private fun startLocalBridgeServer() {
        if (serverRunning) return
        serverRunning = true
        Thread({
            try {
                val server = ServerSocket(8765, 20, InetAddress.getByName("127.0.0.1"))
                localServer = server
                while (serverRunning) {
                    val client = try { server.accept() } catch (_: Exception) { break }
                    Thread({ handleLocalRequest(client) }, "philips-local-client").start()
                }
            } catch (_: Exception) {
                serverRunning = false
            }
        }, "philips-local-bridge").start()
    }

    private fun readHttpLine(input: InputStream): String? {
        val bytes = java.io.ByteArrayOutputStream()
        while (true) {
            val value = input.read()
            if (value == -1) return if (bytes.size() == 0) null else bytes.toString("UTF-8")
            if (value == 10) break
            if (value != 13) bytes.write(value)
            if (bytes.size() > 8192) return null
        }
        return bytes.toString("UTF-8")
    }

    private fun handleLocalRequest(socket: Socket) {
        socket.use { client ->
            try {
                client.soTimeout = 5000
                val input = client.getInputStream()
                val request = readHttpLine(input) ?: return
                val parts = request.split(" ")
                val method = parts.getOrNull(0) ?: ""
                val path = parts.getOrNull(1)?.substringBefore("?") ?: ""
                val headers = mutableMapOf<String, String>()
                while (true) {
                    val line = readHttpLine(input) ?: break
                    if (line.isEmpty()) break
                    val split = line.indexOf(":")
                    if (split > 0) headers[line.substring(0, split).trim().lowercase()] = line.substring(split + 1).trim()
                }
                if (headers["origin"] != "https://philips-pocket-zapper.lovable.app") {
                    val denied = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    client.getOutputStream().use { it.write(denied.toByteArray(StandardCharsets.US_ASCII)) }
                    return
                }
                val length = (headers["content-length"] ?: "0").toIntOrNull()?.coerceIn(0, 8192) ?: 0
                val bodyBytes = ByteArray(length)
                var offset = 0
                while (offset < length) {
                    val count = input.read(bodyBytes, offset, length - offset)
                    if (count <= 0) break
                    offset += count
                }
                val body = String(bodyBytes, 0, offset, StandardCharsets.UTF_8)
                val validPath = (method == "GET" && path == "/status") || (method == "POST" && path in listOf("/connect", "/send"))
                val result = when {
                    method == "OPTIONS" -> ""
                    method == "GET" && path == "/status" -> IrBridge().getStatus()
                    method == "POST" && path == "/connect" -> IrBridge().connectNetwork(JSONObject(body).optString("ip"), JSONObject(body).optString("mac"))
                    method == "POST" && path == "/send" -> IrBridge().send(JSONObject(body).optString("command"))
                    else -> JSONObject().put("ok", false).put("message", "Endpoint local desconhecido.").toString()
                }
                val status = when {
                    method == "OPTIONS" -> "204 No Content"
                    validPath -> "200 OK"
                    else -> "404 Not Found"
                }
                val bytes = result.toByteArray(StandardCharsets.UTF_8)
                val output: OutputStream = client.getOutputStream()
                val responseHeaders = "HTTP/1.1 $status\r\n" +
                    "Access-Control-Allow-Origin: https://philips-pocket-zapper.lovable.app\r\n" +
                    "Vary: Origin\r\n" +
                    "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                    "Access-Control-Allow-Headers: Content-Type\r\n" +
                    "Access-Control-Allow-Private-Network: true\r\n" +
                    "Content-Type: application/json; charset=utf-8\r\n" +
                    "Content-Length: " + (if (method == "OPTIONS") 0 else bytes.size) + "\r\n" +
                    "Connection: close\r\n\r\n"
                output.write(responseHeaders.toByteArray(StandardCharsets.US_ASCII))
                if (method != "OPTIONS") output.write(bytes)
                output.flush()
            } catch (_: Exception) { }
        }
    }

    private fun isTrustedUrl(uri: Uri): Boolean =
        uri.scheme == "https" && uri.host == APP_HOST

    inner class IrBridge {
        @JavascriptInterface
        fun getStatus(): String {
            val manager = ir
            val available = manager?.hasIrEmitter() == true
            val carrierRanges = if (available) manager?.carrierFrequencies else null
            val supports36kHz = carrierRanges?.any { range ->
                range.minFrequency <= 36000 && 36000 <= range.maxFrequency
            } ?: false
            // Some Android IR blasters expose 38 kHz instead of exactly 36 kHz.
            val rc6Carrier = supportedRc6Carrier(manager)
            val host = tvHost
            val connected = host != null && probeTv(host)
            if (!connected) tvHost = null
            return JSONObject()
                .put("available", available)
                .put("irAvailable", available)
                .put("supports36kHz", supports36kHz)
                .put("supportsRc6Carrier", rc6Carrier != null)
                .put("rc6CarrierHz", rc6Carrier ?: 0)
                .put("carrierRangesHz", org.json.JSONArray().also { array ->
                    carrierRanges?.forEach { range ->
                        array.put(org.json.JSONArray().put(range.minFrequency).put(range.maxFrequency))
                    }
                })
                .put("transport", when {
                    available && rc6Carrier != null -> "infrared"
                    connected -> "wifi"
                    else -> "waiting"
                })
                .put("manufacturer", android.os.Build.MANUFACTURER)
                .put("deviceModel", android.os.Build.MODEL)
                .put("profile", MODEL)
                .put("profileConfigured", commands.isNotEmpty())
                .put("protocol", "Philips RC6 mode 0 (36 kHz; 38 kHz apenas se suportado pelo emissor)")
                .put("networkConnected", connected)
                .put("message", when {
                    available && rc6Carrier != null -> "Emissor infravermelho compatível detectado (" + rc6Carrier + " Hz). Controle IR disponível."
                    available -> "Este celular tem infravermelho, mas não confirmou suporte a 36 ou 38 kHz. O aplicativo tentará usar Wi-Fi."
                    connected -> "TV acessível pela rede Wi-Fi. Controle automático por Wi-Fi neste aparelho."
                    available.not() -> "Este celular não tem emissor infravermelho. Use o controle pela rede Wi-Fi."
                    else -> "Aguardando conexão com a TV pela rede Wi-Fi."
                }).toString()
        }

        @JavascriptInterface
        fun connectNetwork(ip: String, mac: String): String {
            val host = ip.trim()
            if (!IPV4.matches(host)) {
                return result(false, "Digite um endereço IPv4 válido da TV, por exemplo 192.168.1.50.")
            }
            val cleanMac = mac.trim().uppercase().replace("-", ":")
            if (cleanMac.isNotEmpty() && !MAC.matches(cleanMac)) {
                return result(false, "MAC inválido. Use o formato AA:BB:CC:DD:EE:FF.")
            }
            val prefs = getSharedPreferences("philips_remote", Context.MODE_PRIVATE)
            prefs.edit().putString("tv_ip", host).apply()
            if (cleanMac.isNotEmpty()) prefs.edit().putString("tv_mac", cleanMac).apply()
            val versions = listOf(6, 5, 1)
            for (version in versions) {
                var connection: HttpURLConnection? = null
                try {
                    connection = URL("http://$host:1925/$version/system").openConnection() as HttpURLConnection
                    connection.requestMethod = "GET"
                    connection.connectTimeout = 2500
                    connection.readTimeout = 2500
                    connection.setRequestProperty("Accept", "application/json")
                    val code = connection.responseCode
                    if (code == HttpURLConnection.HTTP_OK) {
                        val body = connection.inputStream.bufferedReader().use { it.readText() }
                        val json = JSONObject(body)
                        if (json.has("api_version") || json.has("system") || json.has("name")) {
                            tvHost = host
                            tvApiVersion = version
                            prefs.edit().putInt("tv_api_version", version).apply()
                            return JSONObject()
                                .put("ok", true)
                                .put("message", "TV Philips encontrada na rede. API SAPHI v$version respondeu.")
                                .put("ip", host)
                                .put("apiVersion", version)
                                .toString()
                        }
                    }
                } catch (_: Exception) {
                    // Try the next known SAPHI API version.
                } finally {
                    connection?.disconnect()
                }
            }
            tvHost = null
            return result(false, "TV não respondeu no IP salvo. Confira a rede, o IP e se a TV está ligada; a tentativa será repetida automaticamente.")
        }

        @JavascriptInterface
        fun send(command: String): String {
            val normalized = command.uppercase()
            val prefs = getSharedPreferences("philips_remote", Context.MODE_PRIVATE)
            var host = tvHost
            // Power is intentionally Wi-Fi-first. In standby, SAPHI may not answer;
            // Wake-on-Wi-Fi (WoWLAN) must be enabled on the TV and the saved MAC is
            // used to send a magic packet on the local network.
            val manager = ir
            val hasIr = manager?.hasIrEmitter() == true
            val rc6Carrier = if (hasIr) supportedRc6Carrier(manager) else null

            if (host == null) {
                val savedIp = prefs.getString("tv_ip", null)
                if (!savedIp.isNullOrBlank()) {
                    try {
                        val reconnect = JSONObject(connectNetwork(savedIp, prefs.getString("tv_mac", "") ?: ""))
                        if (reconnect.optBoolean("ok")) host = tvHost
                    } catch (_: Exception) { }
                }
            }

            if (normalized == "POWER") {
                val mac = prefs.getString("tv_mac", null)
                if (host == null) {
                    return if (!mac.isNullOrBlank()) wakeOnLan(mac, prefs.getString("tv_ip", null))
                    else result(false, "Para ligar por Wi-Fi em standby, habilite “Ligar com Wi-Fi (WoWLAN)” na TV e informe o MAC dela no aplicativo. O IP salvo é 192.168.1.2.")
                }
                val state = readPowerState(host)
                if (state != "on") {
                    return if (!mac.isNullOrBlank()) wakeOnLan(mac, host)
                    else result(false, "A TV não confirmou que está ligada. Habilite “Ligar com Wi-Fi (WoWLAN)” e informe o MAC da TV para acordá-la pela rede.")
                }
                // When the TV is awake, the SAPHI API sends the standby command below.
            }

            val networkKey = networkKey(normalized)
            host = tvHost
            if (host != null && networkKey != null) {
                var connection: HttpURLConnection? = null
                return try {
                    connection = URL("http://$host:1925/$tvApiVersion/input/key").openConnection() as HttpURLConnection
                    connection.requestMethod = "POST"
                    connection.connectTimeout = 2500
                    connection.readTimeout = 2500
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.outputStream.use {
                        it.write(JSONObject().put("key", networkKey).toString().toByteArray(Charsets.UTF_8))
                    }
                    val code = connection.responseCode
                    if (code in 200..299) {
                        result(true, "Comando enviado à TV pela rede Wi-Fi.")
                    } else {
                        result(false, "A TV respondeu com HTTP $code. Tente sincronizar novamente.")
                    }
                } catch (e: Exception) {
                    result(false, "Falha ao enviar comando pela rede: ${e.message ?: "erro de conexão"}.")
                } finally {
                    connection?.disconnect()
                }
            }

            if (normalized != "POWER" && hasIr && rc6Carrier != null) {
                return transmitPhilipsRc6(manager!!, normalized, rc6Carrier)
            }
            return result(false, if (normalized == "POWER") "Não foi possível acordar a TV por Wi-Fi. Confira se WoWLAN está ligado, se o MAC está correto e se celular e TV estão na mesma rede." else if (hasIr) "Wi-Fi indisponível e o emissor IR deste celular não suporta 36 ou 38 kHz." else "Este celular não possui emissor infravermelho. Conecte a TV pela rede Wi-Fi.")
        }

        private fun supportedRc6Carrier(manager: ConsumerIrManager?): Int? {
            val ranges = manager?.carrierFrequencies ?: return null
            return when {
                ranges.any { it.minFrequency <= 36000 && 36000 <= it.maxFrequency } -> 36000
                ranges.any { it.minFrequency <= 38000 && 38000 <= it.maxFrequency } -> 38000
                else -> null
            }
        }

        private fun transmitPhilipsRc6(manager: ConsumerIrManager, command: String, carrierHz: Int): String {
            val code = commands[command]
                ?: return result(false, "Comando IR ainda não mapeado: $command.")
            return synchronized(this@MainActivity) {
                try {
                    val currentToggle = rc6Toggle
                    val pattern = buildRc6Mode0(address = 0x00, command = code, toggle = currentToggle)
                    manager.transmit(carrierHz, pattern)
                    // Advance and persist only after Android accepts the transmission.
                    rc6Toggle = !currentToggle
                    getSharedPreferences("philips_remote", Context.MODE_PRIVATE)
                        .edit().putBoolean("rc6_toggle", rc6Toggle).apply()
                    result(true, "Comando $command transmitido por infravermelho Philips RC6. Aponte o topo do celular para o sensor da TV.")
                } catch (e: Exception) {
                    result(false, "Falha na transmissão IR: ${e.message ?: "erro desconhecido"}")
                }
            }
        }

        // ConsumerIrManager expects alternating mark/space durations in microseconds.
        // RC6 mode 0: 6T mark + 2T space, start + 3 mode bits, double-width toggle,
        // 8-bit address and 8-bit command. T = 444 microseconds.
        private fun buildRc6Mode0(address: Int, command: Int, toggle: Boolean): IntArray {
            data class Run(val mark: Boolean, val duration: Int)
            val runs = mutableListOf<Run>()
            fun add(mark: Boolean, duration: Int) {
                if (runs.isNotEmpty() && runs.last().mark == mark) {
                    val last = runs.removeAt(runs.lastIndex)
                    runs.add(Run(mark, last.duration + duration))
                } else runs.add(Run(mark, duration))
            }
            fun bit(value: Int, width: Int = 1) {
                val half = 444 * width
                if (value == 1) {
                    add(true, half); add(false, half)
                } else {
                    add(false, half); add(true, half)
                }
            }
            add(true, 2666)
            add(false, 889)
            bit(1) // start
            bit(0); bit(0); bit(0) // mode 0
            bit(if (toggle) 1 else 0, 2) // trailer/toggle bit is double width
            for (shift in 7 downTo 0) bit((address shr shift) and 1)
            for (shift in 7 downTo 0) bit((command shr shift) and 1)
            // Android requires the pattern to start with a mark and alternate mark/space.
            return runs.map { it.duration.coerceAtLeast(1) }.toIntArray()
        }

        private fun probeTv(host: String): Boolean {
            var connection: HttpURLConnection? = null
            return try {
                connection = URL("http://" + host + ":1925/" + tvApiVersion + "/system").openConnection() as HttpURLConnection
                connection.requestMethod = "GET"
                connection.connectTimeout = 1800
                connection.readTimeout = 1800
                connection.responseCode == HttpURLConnection.HTTP_OK
            } catch (_: Exception) { false }
            finally { connection?.disconnect() }
        }

        private fun readPowerState(host: String): String? {
            var connection: HttpURLConnection? = null
            return try {
                connection = URL("http://" + host + ":1925/" + tvApiVersion + "/powerstate").openConnection() as HttpURLConnection
                connection.requestMethod = "GET"
                connection.connectTimeout = 1800
                connection.readTimeout = 1800
                if (connection.responseCode !in 200..299) return null
                val json = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                json.optString("powerstate").lowercase().takeIf { it.isNotBlank() }
            } catch (_: Exception) { null }
            finally { connection?.disconnect() }
        }

        private fun wakeOnLan(macAddress: String, ip: String?): String {
            val mac = macAddress.trim().uppercase().replace("-", ":")
            if (!MAC.matches(mac)) return result(false, "MAC inválido. Use AA:BB:CC:DD:EE:FF.")
            return try {
                val bytes = mac.split(":").map { it.toInt(16).toByte() }.toByteArray()
                val packet = ByteArray(6 + 16 * bytes.size)
                for (i in 0 until 6) packet[i] = 0xFF.toByte()
                for (i in 0 until 16) System.arraycopy(bytes, 0, packet, 6 + i * bytes.size, bytes.size)
                DatagramSocket().use { socket ->
                    socket.broadcast = true
                    val targets = linkedSetOf("255.255.255.255")
                    if (!ip.isNullOrBlank() && IPV4.matches(ip)) {
                        val octets = ip.split(".")
                        targets.add(octets[0] + "." + octets[1] + "." + octets[2] + ".255")
                    }
                    targets.forEach { address ->
                        socket.send(DatagramPacket(packet, packet.size, InetAddress.getByName(address), 9))
                    }
                }
                result(true, "Pacote Wake-on-LAN enviado. A TV só ligará se Wake-on-LAN/rede em standby estiver habilitado; confirme a tela da TV.")
            } catch (e: Exception) {
                result(false, "Não foi possível enviar Wake-on-LAN: " + (e.message ?: "erro de rede") + ".")
            }
        }

        private fun networkKey(command: String): String? {
            if (command.startsWith("NUM_")) {
                val digit = command.removePrefix("NUM_")
                if (digit.length == 1 && digit[0] in '0'..'9') return "Digit$digit"
            }
            return when (command) {
                "POWER" -> "Standby"
                "UP" -> "CursorUp"
                "DOWN" -> "CursorDown"
                "LEFT" -> "CursorLeft"
                "RIGHT" -> "CursorRight"
                "OK" -> "Confirm"
                "BACK", "EXIT" -> "Back"
                "MENU" -> "Home"
                "SOURCE", "AV", "HDMI" -> "Source"
                "TV" -> "WatchTV"
                "MUTE" -> "Mute"
                "VOLUME_UP" -> "VolumeUp"
                "VOLUME_DOWN" -> "VolumeDown"
                "CHANNEL_UP" -> "ChannelStepUp"
                "CHANNEL_DOWN" -> "ChannelStepDown"
                "INFO" -> "Info"
                else -> null
            }
        }

        private fun result(ok: Boolean, message: String) =
            JSONObject().put("ok", ok).put("message", message).toString()
    }

    companion object {
        private const val APP_URL = "https://philips-pocket-zapper.lovable.app"
        private const val APP_HOST = "philips-pocket-zapper.lovable.app"
        private const val MODEL = "Philips 50PUG6654/78"
        private val MAC = Regex("^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$")
        private val IPV4 = Regex("^(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}$")
    }
}