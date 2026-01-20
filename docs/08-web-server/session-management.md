# Actor 기반 세션 관리

> Actor Model을 활용한 사용자 세션 관리 패턴을 다룹니다.

## 한 줄 요약

**각 사용자 세션을 Actor로 모델링하여 상태를 안전하게 관리하고 자동 정리**

---

## 세션 Actor 설계

```
┌─────────────────────────────────────────────────────────────────┐
│                   세션 Actor 구조                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Session Actor = 사용자 세션의 1:1 대응                         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   SessionGrain                          │   │
│  │                                                         │   │
│  │  State:                                                 │   │
│  │  ├── SessionId                                         │   │
│  │  ├── UserId                                            │   │
│  │  ├── CreatedAt                                         │   │
│  │  ├── LastAccessedAt                                    │   │
│  │  ├── ExpiresAt                                         │   │
│  │  ├── Data (Dictionary)                                 │   │
│  │  └── IsAuthenticated                                   │   │
│  │                                                         │   │
│  │  Methods:                                               │   │
│  │  ├── Create(userId)                                    │   │
│  │  ├── Get(key)                                          │   │
│  │  ├── Set(key, value)                                   │   │
│  │  ├── Touch() - 만료 연장                               │   │
│  │  ├── Invalidate()                                      │   │
│  │  └── IsValid()                                         │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Orleans 구현

```csharp
// 세션 인터페이스
public interface ISessionGrain : IGrainWithStringKey
{
    Task<SessionInfo> Create(string userId, TimeSpan? ttl = null);
    Task<T> Get<T>(string key);
    Task Set<T>(string key, T value);
    Task Remove(string key);
    Task Touch();
    Task<bool> IsValid();
    Task Invalidate();
    Task<SessionInfo> GetInfo();
}

// 세션 상태
[Serializable]
public class SessionState
{
    public string SessionId { get; set; }
    public string UserId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastAccessedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public Dictionary<string, byte[]> Data { get; set; } = new();
    public bool IsAuthenticated { get; set; }
}

// 세션 Grain 구현
public class SessionGrain : Grain, ISessionGrain
{
    private readonly IPersistentState<SessionState> _state;
    private IDisposable _expirationTimer;

    public SessionGrain(
        [PersistentState("session", "sessionStore")]
        IPersistentState<SessionState> state)
    {
        _state = state;
    }

    public override Task OnActivateAsync(CancellationToken token)
    {
        // 만료 체크 타이머
        _expirationTimer = RegisterTimer(
            CheckExpiration,
            null,
            TimeSpan.FromMinutes(1),
            TimeSpan.FromMinutes(1)
        );

        return base.OnActivateAsync(token);
    }

    public async Task<SessionInfo> Create(string userId, TimeSpan? ttl = null)
    {
        var now = DateTime.UtcNow;
        var expiration = ttl ?? TimeSpan.FromHours(24);

        _state.State = new SessionState
        {
            SessionId = this.GetPrimaryKeyString(),
            UserId = userId,
            CreatedAt = now,
            LastAccessedAt = now,
            ExpiresAt = now.Add(expiration),
            IsAuthenticated = true
        };

        await _state.WriteStateAsync();

        return GetSessionInfo();
    }

    public async Task<T> Get<T>(string key)
    {
        await Touch();

        if (_state.State.Data.TryGetValue(key, out var bytes))
        {
            return JsonSerializer.Deserialize<T>(bytes);
        }

        return default;
    }

    public async Task Set<T>(string key, T value)
    {
        await Touch();

        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        _state.State.Data[key] = bytes;

        await _state.WriteStateAsync();
    }

    public async Task Touch()
    {
        if (!await IsValid())
            throw new SessionExpiredException();

        var now = DateTime.UtcNow;
        var remainingTime = _state.State.ExpiresAt - now;

        // 슬라이딩 만료: 절반 이상 지났으면 연장
        if (remainingTime < TimeSpan.FromHours(12))
        {
            _state.State.ExpiresAt = now.AddHours(24);
        }

        _state.State.LastAccessedAt = now;
        await _state.WriteStateAsync();
    }

    public Task<bool> IsValid()
    {
        if (_state.State == null)
            return Task.FromResult(false);

        return Task.FromResult(
            _state.State.IsAuthenticated &&
            _state.State.ExpiresAt > DateTime.UtcNow
        );
    }

    public async Task Invalidate()
    {
        _state.State.IsAuthenticated = false;
        _state.State.ExpiresAt = DateTime.UtcNow;
        await _state.WriteStateAsync();

        // Grain 비활성화
        DeactivateOnIdle();
    }

    private async Task CheckExpiration(object _)
    {
        if (_state.State != null && _state.State.ExpiresAt <= DateTime.UtcNow)
        {
            await Invalidate();
        }
    }

    private SessionInfo GetSessionInfo() => new()
    {
        SessionId = _state.State.SessionId,
        UserId = _state.State.UserId,
        CreatedAt = _state.State.CreatedAt,
        ExpiresAt = _state.State.ExpiresAt,
        IsAuthenticated = _state.State.IsAuthenticated
    };
}
```

---

## ASP.NET Core 미들웨어 통합

```csharp
// 세션 미들웨어
public class ActorSessionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IClusterClient _orleans;

    public ActorSessionMiddleware(RequestDelegate next, IClusterClient orleans)
    {
        _next = next;
        _orleans = orleans;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var sessionId = context.Request.Cookies["SessionId"];

        if (!string.IsNullOrEmpty(sessionId))
        {
            var sessionGrain = _orleans.GetGrain<ISessionGrain>(sessionId);

            if (await sessionGrain.IsValid())
            {
                // 세션 정보를 HttpContext에 저장
                var sessionInfo = await sessionGrain.GetInfo();
                context.Items["Session"] = sessionGrain;
                context.Items["SessionInfo"] = sessionInfo;
                context.Items["UserId"] = sessionInfo.UserId;
            }
            else
            {
                // 만료된 세션 쿠키 삭제
                context.Response.Cookies.Delete("SessionId");
            }
        }

        await _next(context);
    }
}

// 확장 메서드
public static class SessionExtensions
{
    public static ISessionGrain GetSession(this HttpContext context)
    {
        return context.Items["Session"] as ISessionGrain;
    }

    public static string GetUserId(this HttpContext context)
    {
        return context.Items["UserId"] as string;
    }

    public static bool IsAuthenticated(this HttpContext context)
    {
        return context.Items.ContainsKey("Session");
    }
}

// 컨트롤러에서 사용
[ApiController]
[Route("api/cart")]
public class CartController : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<Cart>> GetCart()
    {
        var session = HttpContext.GetSession();
        if (session == null)
            return Unauthorized();

        var cart = await session.Get<Cart>("cart");
        return Ok(cart ?? new Cart());
    }

    [HttpPost("items")]
    public async Task<ActionResult> AddToCart([FromBody] CartItem item)
    {
        var session = HttpContext.GetSession();
        if (session == null)
            return Unauthorized();

        var cart = await session.Get<Cart>("cart") ?? new Cart();
        cart.Items.Add(item);
        await session.Set("cart", cart);

        return Ok();
    }
}
```

---

## 세션 클러스터 관리

```csharp
// 세션 관리자 (전역 관리)
public interface ISessionManagerGrain : IGrainWithIntegerKey
{
    Task<string> CreateSession(string userId);
    Task InvalidateUserSessions(string userId);
    Task<int> GetActiveSessionCount();
    Task CleanupExpiredSessions();
}

public class SessionManagerGrain : Grain, ISessionManagerGrain
{
    private readonly IPersistentState<SessionManagerState> _state;

    public async Task<string> CreateSession(string userId)
    {
        var sessionId = Guid.NewGuid().ToString("N");
        var sessionGrain = GrainFactory.GetGrain<ISessionGrain>(sessionId);

        await sessionGrain.Create(userId);

        // 사용자별 세션 ID 기록
        if (!_state.State.UserSessions.ContainsKey(userId))
            _state.State.UserSessions[userId] = new HashSet<string>();

        _state.State.UserSessions[userId].Add(sessionId);
        await _state.WriteStateAsync();

        return sessionId;
    }

    public async Task InvalidateUserSessions(string userId)
    {
        if (!_state.State.UserSessions.TryGetValue(userId, out var sessions))
            return;

        foreach (var sessionId in sessions)
        {
            var sessionGrain = GrainFactory.GetGrain<ISessionGrain>(sessionId);
            await sessionGrain.Invalidate();
        }

        _state.State.UserSessions.Remove(userId);
        await _state.WriteStateAsync();
    }

    public async Task CleanupExpiredSessions()
    {
        var toRemove = new List<(string UserId, string SessionId)>();

        foreach (var (userId, sessions) in _state.State.UserSessions)
        {
            foreach (var sessionId in sessions)
            {
                var sessionGrain = GrainFactory.GetGrain<ISessionGrain>(sessionId);
                if (!await sessionGrain.IsValid())
                {
                    toRemove.Add((userId, sessionId));
                }
            }
        }

        foreach (var (userId, sessionId) in toRemove)
        {
            _state.State.UserSessions[userId].Remove(sessionId);
        }

        await _state.WriteStateAsync();
    }
}
```

---

## JWT + Actor 세션 하이브리드

```csharp
// JWT로 인증, Actor로 세션 데이터 관리
public class HybridAuthService
{
    private readonly IClusterClient _orleans;
    private readonly IJwtService _jwt;

    public async Task<AuthResult> Login(string email, string password)
    {
        // 1. 인증 (기존 방식)
        var user = await ValidateCredentials(email, password);
        if (user == null)
            return AuthResult.InvalidCredentials;

        // 2. JWT 발급 (stateless 인증)
        var token = _jwt.GenerateToken(user.Id, user.Roles);

        // 3. Actor 세션 생성 (stateful 데이터)
        var sessionManager = _orleans.GetGrain<ISessionManagerGrain>(0);
        var sessionId = await sessionManager.CreateSession(user.Id);

        // 4. 세션에 초기 데이터 저장
        var session = _orleans.GetGrain<ISessionGrain>(sessionId);
        await session.Set("preferences", user.Preferences);
        await session.Set("permissions", user.Permissions);

        return new AuthResult
        {
            Success = true,
            Token = token,
            SessionId = sessionId
        };
    }
}

// 미들웨어: JWT 검증 + 세션 로드
public class HybridAuthMiddleware
{
    public async Task InvokeAsync(HttpContext context)
    {
        var token = context.Request.Headers["Authorization"]
            .FirstOrDefault()?.Replace("Bearer ", "");

        var sessionId = context.Request.Headers["X-Session-Id"].FirstOrDefault();

        if (!string.IsNullOrEmpty(token))
        {
            // JWT 검증 (stateless)
            var principal = _jwt.ValidateToken(token);
            if (principal != null)
            {
                context.User = principal;

                // 세션 데이터 로드 (stateful)
                if (!string.IsNullOrEmpty(sessionId))
                {
                    var session = _orleans.GetGrain<ISessionGrain>(sessionId);
                    if (await session.IsValid())
                    {
                        context.Items["Session"] = session;
                    }
                }
            }
        }

        await _next(context);
    }
}
```

---

## 분산 세션 장점

```
┌─────────────────────────────────────────────────────────────────┐
│               Actor 세션 vs 전통적 세션                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  전통적 세션 (In-Memory / Redis):                               │
│  ──────────────────────────────                                 │
│  • Sticky Session 필요 또는 공유 저장소                         │
│  • 만료 관리가 수동적                                           │
│  • 대규모에서 병목 가능                                          │
│                                                                 │
│  Actor 세션:                                                    │
│  ────────────                                                   │
│  ✅ 자동 분산 (클러스터 내 어디서든 접근)                        │
│  ✅ 능동적 만료 관리 (타이머)                                    │
│  ✅ 세션별 독립적 스케일                                         │
│  ✅ 복잡한 세션 로직 가능 (상태 머신 등)                         │
│  ✅ 다른 Actor와 자연스러운 통합                                 │
│                                                                 │
│  ⚠️ 주의사항:                                                   │
│  • 단순 키-값 저장은 Redis가 더 빠름                            │
│  • Actor 오버헤드 존재                                          │
│  • 소규모에서는 과도한 복잡성                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 다음 단계

- [stateful-vs-stateless.md](./stateful-vs-stateless.md) - 아키텍처 선택
- [scaling-patterns.md](./scaling-patterns.md) - 스케일링 전략
- [request-response.md](./request-response.md) - 요청-응답 패턴
