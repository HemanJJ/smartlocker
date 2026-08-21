using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using isRock.LineBot;
using SkbApi.Services;

var builder = WebApplication.CreateBuilder(args);

var channelAccessToken = Environment.GetEnvironmentVariable("LINE_CHANNEL_ACCESS_TOKEN");
var channelSecret = Environment.GetEnvironmentVariable("LINE_CHANNEL_SECRET");
var ollamaBase = "http://localhost:11434";
var ragScript = Path.Combine(
    Environment.CurrentDirectory, "..", "..", "rag_search.py");

var httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };

// 去重
var processedEvents = new ConcurrentDictionary<string, DateTime>();

// 取件碼服務
var codeService = new PickupCodeService();
var sheetService = new GoogleSheetsService(builder.Configuration);

// 啟動時從 Sheet 載入
try
{
    var existing = sheetService.ReadAllCodes().GetAwaiter().GetResult();
    codeService.LoadFromSheet(existing);
}
catch (Exception ex)
{
    Console.WriteLine($"[啟動] Sheet 載入略過：{ex.Message}");
}

var app = builder.Build();

// 提供靜態檔案（LIFF 頁面）
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    ServeUnknownFileTypes = true
});

/* ================= LINE Webhook ================= */

app.MapPost("/api/webhook", async (HttpContext context) =>
{
    using var reader = new StreamReader(context.Request.Body);
    var body = await reader.ReadToEndAsync();

    if (!string.IsNullOrEmpty(channelSecret))
    {
        var signature = context.Request.Headers["X-Line-Signature"].FirstOrDefault();
        var key = Encoding.UTF8.GetBytes(channelSecret);
        var hmac = new HMACSHA256(key);
        var computed = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(body)));
        if (computed != signature)
            Console.WriteLine("[Webhook] 簽章不符");
    }

    try
    {
        var json = JObject.Parse(body);
        var events = json["events"] as JArray;
        if (events == null || events.Count == 0)
            return Results.Ok(new { status = "ok" });

        foreach (var evt in events)
        {
            var eventType = evt["type"]?.ToString();
            var replyToken = evt["replyToken"]?.ToString();
            var msgType = evt["message"]?["type"]?.ToString();
            var text = evt["message"]?["text"]?.ToString();
            var webhookEventId = evt["webhookEventId"]?.ToString();

            if (webhookEventId != null && !processedEvents.TryAdd(webhookEventId, DateTime.Now))
                continue;

            var expired = processedEvents.Where(kv => (DateTime.Now - kv.Value).TotalMinutes > 5)
                .Select(kv => kv.Key).ToList();
            foreach (var key in expired)
                processedEvents.TryRemove(key, out _);

            if (eventType != "message" || msgType != "text" || replyToken == null || string.IsNullOrEmpty(text))
                continue;

            Console.WriteLine($"[Webhook] 處理: {text}");

            // 取件碼查詢
            string? pickupReply = await HandlePickupQuery(text);
            if (pickupReply != null)
            {
                Console.WriteLine($"[取件碼] 查詢回覆: {pickupReply}");
                if (channelAccessToken != null)
                    Utility.ReplyMessage(replyToken, pickupReply, channelAccessToken);
                continue;
            }

            // RAG
            var ragContext = await SearchRag(text);

            var systemPrompt = "你是「迪飛羽球館」的 LINE 客服助理。你的名字叫小羽。回答只使用繁體中文，1-3 句話就好，語氣親切自然。不確定的不要亂編，就說「我幫您確認一下」，名叫小羽。態度親切、熱情。回答簡短且有用，使用繁體中文。";
            if (!string.IsNullOrEmpty(ragContext))
                systemPrompt += $"\n\n以下是內部知識庫中與此問題相關的資訊，請根據這些來回答：\n\n{ragContext}";

            var ollamaReply = await CallOllama(systemPrompt, text);
            Console.WriteLine($"[Ollama] 回覆: {ollamaReply}");

            if (channelAccessToken != null)
                Utility.ReplyMessage(replyToken, ollamaReply, channelAccessToken);
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Webhook] 錯誤: {ex.Message}");
    }

    return Results.Ok();
});

/* ================= 取件碼 API ================= */

app.MapPost("/api/code/generate", async (HttpContext context) =>
{
    try
    {
        using var reader = new StreamReader(context.Request.Body);
        var body = await reader.ReadToEndAsync();
        var req = JObject.Parse(body);

        int cell = req["cell"]?.Value<int>() ?? 0;
        string? lineUserId = req["lineUserId"]?.ToString();
        string? lineName = req["lineName"]?.ToString();
        string? venue = req["venue"]?.ToString();
        string? bookingDate = req["bookingDate"]?.ToString();
        string? timeSlot = req["timeSlot"]?.ToString();

        if (cell < 1)
            return Results.BadRequest(new { ok = false, error = "invalid_cell" });

        var pickup = codeService.Generate(cell, lineUserId ?? "", lineName ?? "", venue ?? "", bookingDate ?? "", timeSlot ?? "");

        // 寫入 Google Sheet
        _ = sheetService.WritePickupCode(pickup.Code, cell, pickup.ExpiryUtc);

        // 寫入 SkbBridge 本機快取（讓 kiosk 不必等 60 秒同步）
        WriteToLocalCache(pickup.Code, cell);

        // LINE 推播
        if (!string.IsNullOrEmpty(lineUserId) && !string.IsNullOrEmpty(channelAccessToken))
        {
            try
            {
                var pushMsg = $"🎾 您的取件碼已準備好！\n\n" +
                              $"📦 取件碼：{pickup.Code}\n" +
                              $"🔢 格  號：第 {cell} 格\n" +
                              $"🏸 場  館：{venue ?? "-"}\n" +
                              $"📅 時  段：{bookingDate ?? "-"} {timeSlot ?? "-"}\n" +
                              $"⏰ 有效期限：{pickup.ExpiryUtc.AddHours(8):yyyy/MM/dd HH:mm}（台灣時間）\n\n" +
                              $"請至迪飛羽球館的智慧拍櫃輸入取件碼取件。";

                Utility.PushMessage(lineUserId, pushMsg, channelAccessToken);
                Console.WriteLine($"[LINE] 已推播取件碼給 {lineUserId}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[LINE] 推播失敗：{ex.Message}");
            }
        }

        return Results.Ok(new
        {
            ok = true,
            code = pickup.Code,
            cell = pickup.Cell,
            expiry = pickup.ExpiryUtc.ToString("yyyy-MM-ddTHH:mm:ssZ"),
            venue = venue ?? "",
            bookingDate = bookingDate ?? "",
            timeSlot = timeSlot ?? ""
        });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { ok = false, error = ex.Message });
    }
});

app.MapGet("/api/code/validate", (HttpContext context) =>
{
    var code = context.Request.Query["code"].FirstOrDefault();
    if (string.IsNullOrEmpty(code))
        return Results.BadRequest(new { ok = false, error = "missing_code" });

    var cell = codeService.Validate(code);

    if (cell == -1)
        return Results.Ok(new { ok = false, valid = false, reason = "invalid_or_expired" });
    if (PickupCodeService.IsUsedResult(cell))
        return Results.Ok(new { ok = false, valid = false, reason = "already_used" });

    return Results.Ok(new { ok = true, valid = true, cell });
});

app.MapPost("/api/code/use", async (HttpContext context) =>
{
    try
    {
        using var reader = new StreamReader(context.Request.Body);
        var body = await reader.ReadToEndAsync();
        var req = JObject.Parse(body);
        var code = req["code"]?.ToString();

        if (string.IsNullOrEmpty(code))
            return Results.BadRequest(new { ok = false, error = "missing_code" });

        int cell = codeService.Validate(code);
        if (cell == -1)
            return Results.Ok(new { ok = false, error = "invalid_or_expired" });
        if (PickupCodeService.IsUsedResult(cell))
            return Results.Ok(new { ok = false, error = "already_used" });

        codeService.MarkUsed(code);
        return Results.Ok(new { ok = true, cell });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { ok = false, error = ex.Message });
    }
});

/// <summary>查詢使用者的訂單列表</summary>
app.MapGet("/api/orders", (HttpContext context) =>
{
    var lineUserId = context.Request.Query["lineUserId"].FirstOrDefault();
    if (string.IsNullOrEmpty(lineUserId))
        return Results.BadRequest(new { ok = false, error = "missing_lineUserId" });

    var orders = codeService.GetUserOrders(lineUserId);
    return Results.Ok(new { ok = true, orders });
});

app.MapGet("/api/codes", () =>
{
    return Results.Ok(new
    {
        ok = true,
        active = codeService.ActiveCount,
        used = codeService.UsedCount
    });
});

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", time = DateTime.Now }));

Console.WriteLine($"SkbApi + RAG + 取件碼服務 啟動");
Console.WriteLine("LIFF 頁面：/liff/booking.html  /liff/orders.html");
app.Run();

/* ================= SkbBridge 本機快取寫入 ================= */

void WriteToLocalCache(string code, int cell)
{
    var cacheFilePath = Environment.GetEnvironmentVariable("SKB_CACHE_FILE")
        ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "codes.cache.csv");
    try
    {
        // codes.cache.csv 格式：取件碼,格號,狀態,備註
        // 由 SkbBridge 的 SheetSync 讀取，kiosk 查本機用
        var line = $"{code},{cell},待取,";
        var dir = Path.GetDirectoryName(cacheFilePath);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            Directory.CreateDirectory(dir);

        // 如果有表頭就 append，沒有就寫新檔含表頭
        bool hasHeader = File.Exists(cacheFilePath) && new System.IO.StreamReader(cacheFilePath).ReadLine()?.StartsWith("取件碼") == true;
        using var sw = File.AppendText(cacheFilePath);
        if (!hasHeader)
        {
            // 寫入第一個檔案時補表頭
            sw.WriteLine("取件碼,格號,狀態,備註");
        }
        sw.WriteLine(line);
        Console.WriteLine($"[快取] 寫入 {cacheFilePath} → {code} 格{cell}");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[快取] 寫入失敗：{ex.Message}");
    }
}

/* ================= 取件碼查詢處理 ================= */

async Task<string?> HandlePickupQuery(string text)
{
    var trimmed = text.Trim();
    if (trimmed.Length != 6 || !trimmed.All(char.IsDigit))
        return null;

    var cell = codeService.Validate(trimmed);

    if (cell == -1)
        return $"您查詢的取件碼 {trimmed} 不存在或已過期。請確認是否輸入正確，或聯繫櫃檯人員協助。";

    if (PickupCodeService.IsUsedResult(cell))
        return $"取件碼 {trimmed} 已經使用過了。若需要再次取件，請向櫃檯申請新的取件碼。";

    return $"✅ 取件碼 {trimmed} 有效！\n對應格號：第 {cell} 格\n請至迪飛羽球館智慧拍櫃輸入取件碼取件。";
}

/* ================= RAG ================= */

async Task<string> SearchRag(string query)
{
    try
    {
        if (!File.Exists(ragScript)) return "";

        var psi = new ProcessStartInfo
        {
            FileName = "python3",
            Arguments = $"{ragScript} \"{query.Replace("\"", "\\\"")}\"",
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        using var proc = Process.Start(psi);
        if (proc == null) return "";

        var output = await proc.StandardOutput.ReadToEndAsync();
        await proc.WaitForExitAsync();

        var results = JsonConvert.DeserializeObject<JArray>(output);
        if (results == null || results.Count == 0) return "";

        var context = new StringBuilder();
        foreach (var r in results)
        {
            var content = r["content"]?.ToString() ?? "";
            context.AppendLine(content);
            context.AppendLine("---");
        }
        return context.ToString();
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[RAG] 錯誤: {ex.Message}");
        return "";
    }
}

/* ================= Ollama ================= */

async Task<string> CallOllama(string systemPrompt, string userMessage)
{
    var payload = new
    {
        model = "qwen2.5:14b",
        messages = new[]
        {
            new { role = "system", content = systemPrompt },
            new { role = "user", content = userMessage }
        },
        stream = false
    };

    var requestJson = JsonConvert.SerializeObject(payload);
    var response = await httpClient.PostAsync(
        $"{ollamaBase}/api/chat",
        new StringContent(requestJson, Encoding.UTF8, "application/json")
    );

    if (!response.IsSuccessStatusCode)
        return "抱歉，我現在有點忙，請稍後再試。";

    var responseJson = await response.Content.ReadAsStringAsync();
    var result = JObject.Parse(responseJson);
    return result["message"]?["content"]?.ToString()?.Trim() ?? "嗯？";
}
