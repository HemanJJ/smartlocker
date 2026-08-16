using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using isRock.LineBot;

var builder = WebApplication.CreateBuilder(args);

var channelAccessToken = Environment.GetEnvironmentVariable("LINE_CHANNEL_ACCESS_TOKEN");
var channelSecret = Environment.GetEnvironmentVariable("LINE_CHANNEL_SECRET");
var ollamaBase = "http://localhost:11434";
var ragScript = Path.Combine(
    Environment.CurrentDirectory, "..", "..", "rag_search.py");

var httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };

// 去重
var processedEvents = new ConcurrentDictionary<string, DateTime>();

var app = builder.Build();

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

            // RAG: 搜尋相關知識
            var ragContext = await SearchRag(text);

            // 如果 RAG 有找到內容，加到 system prompt
            var systemPrompt = "你是「迪飛羽球館」的 LINE 客服助理。你的名字叫小羽。回答只使用繁體中文，1-3 句話就好，語氣親切自然。不確定的不要亂編，就說「我幫您確認一下」，名叫小羽。態度親切、熱情。回答簡短且有用，使用繁體中文。";
            if (!string.IsNullOrEmpty(ragContext))
            {
                systemPrompt += $"\n\n以下是內部知識庫中與此問題相關的資訊，請根據這些來回答：\n\n{ragContext}";
            }

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

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", time = DateTime.Now }));

Console.WriteLine("SkbApi + RAG 啟動（bge-m3 向量搜尋）");
app.Run();

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
