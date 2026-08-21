using System.Collections.Concurrent;

namespace SkbApi.Services;

public sealed class PickupCodeService
{
    private readonly ConcurrentDictionary<string, PickupCode> _codes = new();
    private readonly Random _rng = new();
    private readonly Timer _cleanupTimer;

    public PickupCodeService()
    {
        _cleanupTimer = new Timer(_ => ReleaseExpired(), null, TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));
    }

    public PickupCode Generate(int cell, string lineUserId = "", string lineName = "",
        string venue = "", string bookingDate = "", string timeSlot = "", TimeSpan? ttl = null)
    {
        ttl ??= TimeSpan.FromDays(3);
        var expiry = DateTime.UtcNow + ttl.Value;

        string code;
        do
        {
            code = _rng.Next(100000, 999999).ToString();
        } while (_codes.ContainsKey(code));

        var pickup = new PickupCode
        {
            Code = code,
            Cell = cell,
            ExpiryUtc = expiry,
            Status = PickupStatus.Ready,
            CreatedAt = DateTime.UtcNow,
            LineUserId = lineUserId,
            LineName = lineName,
            Venue = venue,
            BookingDate = bookingDate,
            TimeSlot = timeSlot
        };

        _codes[code] = pickup;
        Console.WriteLine($"[取件碼] 產生 {code} → 格{cell}（{lineName}），到期 {expiry:yyyy-MM-dd HH:mm}");
        return pickup;
    }

    public int Validate(string code)
    {
        if (string.IsNullOrWhiteSpace(code)) return -1;
        code = code.Trim();

        if (!_codes.TryGetValue(code, out var pickup))
            return -1;

        if (pickup.Status == PickupStatus.Used)
            return UsedReturnValue;

        if (DateTime.UtcNow > pickup.ExpiryUtc)
        {
            _codes.TryRemove(code, out _);
            return -1;
        }

        return pickup.Cell;
    }

    public bool MarkUsed(string code)
    {
        if (!_codes.TryGetValue(code, out var pickup)) return false;
        pickup.Status = PickupStatus.Used;
        pickup.UsedAt = DateTime.UtcNow;
        Console.WriteLine($"[取件碼] {code} → 格{pickup.Cell} 已取件");
        return true;
    }

    public PickupCode? GetByCode(string code)
    {
        _codes.TryGetValue(code, out var pickup);
        return pickup;
    }

    public void ReleaseExpired()
    {
        var now = DateTime.UtcNow;
        var expired = _codes.Values
            .Where(c => c.Status == PickupStatus.Ready && now > c.ExpiryUtc)
            .ToList();

        foreach (var c in expired)
        {
            _codes.TryRemove(c.Code, out _);
            Console.WriteLine($"[取件碼] {c.Code} → 格{c.Cell} 已過期釋放");
        }

        if (expired.Count > 0)
            Console.WriteLine($"[取件碼] 本次清理 {expired.Count} 筆過期碼");
    }

    public void LoadFromSheet(IEnumerable<SheetCodeEntry> entries)
    {
        var loaded = 0;
        foreach (var e in entries)
        {
            var s = (e.Status ?? "").Trim();
            if (s.Length > 0 && s != "待取" && s != "pending" && s != "ready")
                continue;

            if (_codes.ContainsKey(e.Code)) continue;

            _codes[e.Code] = new PickupCode
            {
                Code = e.Code,
                Cell = e.Cell,
                ExpiryUtc = string.IsNullOrEmpty(e.Expiry)
                    ? DateTime.UtcNow.AddDays(3)
                    : DateTime.Parse(e.Expiry, null, System.Globalization.DateTimeStyles.RoundtripKind),
                Status = PickupStatus.Ready,
                CreatedAt = DateTime.UtcNow,
                LineUserId = e.LineUserId ?? "",
                LineName = e.LineName ?? "",
                Venue = e.Venue ?? "",
                BookingDate = e.BookingDate ?? "",
                TimeSlot = e.TimeSlot ?? ""
            };
            loaded++;
        }
        Console.WriteLine($"[取件碼] 從 Sheet 載入 {loaded} 筆待取件碼");
    }

    /// <summary>查詢特定使用者的所有訂單</summary>
    public List<object> GetUserOrders(string lineUserId)
    {
        return _codes.Values
            .Where(c => c.LineUserId == lineUserId)
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new
            {
                code = c.Code,
                cell = c.Cell,
                status = c.Status == PickupStatus.Ready
                    ? (DateTime.UtcNow > c.ExpiryUtc ? "expired" : "ready")
                    : "used",
                expiry = c.ExpiryUtc.AddHours(8).ToString("yyyy/MM/dd HH:mm"),
                createdAt = c.CreatedAt.AddHours(8).ToString("yyyy/MM/dd HH:mm"),
                venue = c.Venue,
                bookingDate = c.BookingDate,
                timeSlot = c.TimeSlot
            })
            .Select(o => (object)o)
            .ToList();
    }

    public int ActiveCount => _codes.Values.Count(c => c.Status == PickupStatus.Ready && DateTime.UtcNow <= c.ExpiryUtc);
    public int UsedCount => _codes.Values.Count(c => c.Status == PickupStatus.Used);

    public const int UsedReturnValue = -2;
    public static bool IsUsedResult(int cell) => cell == UsedReturnValue;
}

public sealed class PickupCode
{
    public string Code { get; set; } = "";
    public int Cell { get; set; }
    public DateTime ExpiryUtc { get; set; }
    public PickupStatus Status { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UsedAt { get; set; }
    public string LineUserId { get; set; } = "";
    public string LineName { get; set; } = "";
    public string Venue { get; set; } = "";
    public string BookingDate { get; set; } = "";
    public string TimeSlot { get; set; } = "";
}

public enum PickupStatus { Ready, Used }

public sealed class SheetCodeEntry
{
    public string Code { get; set; } = "";
    public int Cell { get; set; }
    public string Status { get; set; } = "";
    public string Expiry { get; set; } = "";
    public string LineUserId { get; set; } = "";
    public string LineName { get; set; } = "";
    public string Venue { get; set; } = "";
    public string BookingDate { get; set; } = "";
    public string TimeSlot { get; set; } = "";
}
