# Stateful vs Stateless 아키텍처

> 웹 서비스에서 Stateful(Actor 기반)과 Stateless 아키텍처의 선택 기준을 다룹니다.

## 한 줄 요약

**단순 CRUD는 Stateless, 실시간/복잡한 상태는 Stateful(Actor) 선택**

---

## 아키텍처 비교

```
┌─────────────────────────────────────────────────────────────────┐
│             Stateless vs Stateful 비교                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Stateless                       Stateful (Actor)              │
│  ─────────                       ───────────────               │
│                                                                 │
│  ┌─────────┐                     ┌─────────┐                   │
│  │ Request │                     │ Request │                   │
│  └────┬────┘                     └────┬────┘                   │
│       │                               │                        │
│       ▼                               ▼                        │
│  ┌─────────┐                     ┌─────────────┐              │
│  │ Server  │ (아무 서버나 OK)     │ Actor Grain │ (상태 보유)   │
│  │ (상태X) │                     │ [  State  ] │              │
│  └────┬────┘                     └──────┬──────┘              │
│       │                                 │                      │
│       ▼                                 │ (필요시만)            │
│  ┌─────────┐                            ▼                      │
│  │   DB    │ (매번 조회)          ┌─────────┐                 │
│  └─────────┘                     │   DB    │                  │
│                                  └─────────┘                  │
│                                                                 │
│  레이턴시: DB 왕복 포함           레이턴시: 메모리 접근          │
│  확장: 매우 쉬움                  확장: 클러스터 관리 필요       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 선택 기준

```
┌─────────────────────────────────────────────────────────────────┐
│                    선택 기준 체크리스트                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Stateless 선택 (전통적 웹 서버):                               │
│  ──────────────────────────────                                 │
│  □ 요청 간 상태 공유 불필요                                     │
│  □ 단순 CRUD 작업                                               │
│  □ DB 캐시(Redis)로 충분                                        │
│  □ 수평 확장이 최우선                                           │
│  □ 팀이 Actor 모델에 익숙하지 않음                              │
│                                                                 │
│  Stateful/Actor 선택:                                           │
│  ─────────────────────                                          │
│  □ 사용자별 복잡한 상태 관리                                    │
│  □ 실시간 업데이트 필요 (WebSocket, SSE)                        │
│  □ 동시성 제어가 복잡 (락 필요)                                 │
│  □ 이벤트 드리븐 로직                                           │
│  □ 상태 간 상호작용이 빈번                                      │
│                                                                 │
│  하이브리드 (권장):                                              │
│  ─────────────────                                              │
│  □ API 게이트웨이: Stateless                                    │
│  □ 비즈니스 로직: Stateful (Actor)                              │
│  □ 캐시: Redis                                                  │
│  □ 영속화: DB                                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 사례별 권장 아키텍처

### 사례 1: 쇼핑몰

```
┌─────────────────────────────────────────────────────────────────┐
│                    쇼핑몰 아키텍처                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  기능              권장 방식           이유                      │
│  ─────────────────────────────────────────────────────────────  │
│  상품 목록         Stateless + Cache   읽기 전용, 캐시 효과적   │
│  상품 상세         Stateless + Cache   읽기 전용               │
│  장바구니          Stateful (Actor)    사용자별 상태, 실시간    │
│  주문 처리         Stateful (Actor)    트랜잭션, 상태 기계      │
│  재고 관리         Stateful (Actor)    동시성 제어 중요        │
│  결제              Stateful (Actor)    상태 추적 필수          │
│  리뷰/평점         Stateless           단순 CRUD               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 사례 2: 실시간 협업 도구

```csharp
// 실시간 문서 편집 - Stateful 필수
public class DocumentGrain : Grain, IDocumentGrain
{
    private Document _document;
    private readonly HashSet<IDocumentObserver> _collaborators = new();

    public async Task ApplyEdit(string userId, EditOperation op)
    {
        // OT (Operational Transform) 적용
        var transformed = _document.Transform(op);
        _document = _document.Apply(transformed);

        // 모든 협업자에게 실시간 전파
        foreach (var collaborator in _collaborators)
        {
            await collaborator.OnEdit(userId, transformed);
        }
    }

    public Task<Document> GetDocument() => Task.FromResult(_document);

    public Task Subscribe(IDocumentObserver observer)
    {
        _collaborators.Add(observer);
        return Task.CompletedTask;
    }
}

// Stateless로는 불가능한 이유:
// - 동시 편집 충돌 해결 (OT) 필요
// - 실시간 브로드캐스트 필요
// - 일관된 문서 상태 유지 필요
```

### 사례 3: 알림 시스템

```
┌─────────────────────────────────────────────────────────────────┐
│                    알림 시스템                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Stateless 방식 (기본):                                         │
│  ─────────────────────                                          │
│  1. 이벤트 발생                                                 │
│  2. DB에서 구독자 조회                                          │
│  3. 메시지 큐에 전송                                            │
│  4. Worker가 처리                                               │
│                                                                 │
│  → 지연 있음, 대량 처리에 적합                                  │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Stateful 방식 (실시간):                                        │
│  ───────────────────────                                        │
│  1. 이벤트 발생                                                 │
│  2. 사용자 Actor가 구독 목록 보유                               │
│  3. 즉시 WebSocket으로 전송                                     │
│                                                                 │
│  → 즉시 전달, 연결 상태 추적 가능                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 마이그레이션 전략

### Stateless → Stateful 전환

```csharp
// 1단계: 기존 Stateless 서비스
public class UserService
{
    private readonly IDbContext _db;

    public async Task<User> GetUser(string id)
    {
        return await _db.Users.FindAsync(id);
    }

    public async Task UpdateUser(string id, UserUpdate update)
    {
        var user = await _db.Users.FindAsync(id);
        user.Apply(update);
        await _db.SaveChangesAsync();
    }
}

// 2단계: Actor로 래핑 (점진적 전환)
public class UserGrain : Grain, IUserGrain
{
    private readonly IDbContext _db;
    private User _cachedUser;

    public async Task<User> GetUser()
    {
        // 캐시에 있으면 반환
        if (_cachedUser != null)
            return _cachedUser;

        // 없으면 DB 조회 후 캐시
        _cachedUser = await _db.Users.FindAsync(this.GetPrimaryKeyString());
        return _cachedUser;
    }

    public async Task UpdateUser(UserUpdate update)
    {
        var user = await GetUser();
        user.Apply(update);

        // 캐시 업데이트
        _cachedUser = user;

        // DB 저장 (비동기 또는 배치)
        await _db.SaveChangesAsync();
    }
}

// 3단계: 완전한 Stateful (DB는 영속화만)
public class UserGrain : Grain, IUserGrain
{
    private readonly IPersistentState<UserState> _state;

    // DB 직접 접근 없음
    // Orleans가 상태 관리
}
```

---

## 성능 비교

```
┌─────────────────────────────────────────────────────────────────┐
│                    성능 비교 (예시)                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  시나리오: 사용자 프로필 조회                                    │
│                                                                 │
│  Stateless + DB                                                 │
│  ─────────────────                                              │
│  Request → API Server → DB Query (5ms) → Response              │
│  총: ~10-20ms                                                   │
│                                                                 │
│  Stateless + Redis                                              │
│  ────────────────────                                           │
│  Request → API Server → Redis (1ms) → Response                 │
│  총: ~5-10ms                                                    │
│                                                                 │
│  Stateful (Actor, Local)                                        │
│  ─────────────────────────                                      │
│  Request → Actor (in-memory) → Response                        │
│  총: ~1-5ms                                                     │
│                                                                 │
│  Stateful (Actor, Remote)                                       │
│  ──────────────────────────                                     │
│  Request → Network → Actor → Network → Response                │
│  총: ~5-15ms                                                    │
│                                                                 │
│  ※ Actor의 장점은 복잡한 상태 로직에서 더 두드러짐              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 결정 플로우차트

```
시작
  │
  ▼
요청 간 상태 공유 필요? ──No──▶ Stateless
  │
  Yes
  │
  ▼
Redis/Memcached로 충분? ──Yes──▶ Stateless + Cache
  │
  No
  │
  ▼
실시간 푸시 필요? ──Yes──▶ Stateful (Actor)
  │
  No
  │
  ▼
복잡한 동시성 제어? ──Yes──▶ Stateful (Actor)
  │
  No
  │
  ▼
이벤트 기반 로직? ──Yes──▶ Stateful (Actor)
  │
  No
  │
  ▼
Stateless + Cache 권장
```

---

## 다음 단계

- [scaling-patterns.md](./scaling-patterns.md) - 스케일링 전략
- [request-response.md](./request-response.md) - 요청-응답 패턴
- [session-management.md](./session-management.md) - 세션 관리
