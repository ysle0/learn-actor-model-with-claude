# 플레이어 Actor 설계

> 플레이어 세션, 상태, 연결을 관리하는 플레이어 Actor 설계 방법을 다룹니다.

## 한 줄 요약

**플레이어 Actor는 개별 플레이어의 상태, 세션, 메시지 라우팅을 담당하는 1:1 대응 엔티티**

---

## 플레이어 Actor의 역할

```
┌─────────────────────────────────────────────────────────────────┐
│                  플레이어 Actor 책임 영역                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 세션 관리                                                    │
│     ──────────                                                  │
│     • 로그인/로그아웃 처리                                       │
│     • 연결 상태 추적                                             │
│     • 재접속 처리                                                │
│                                                                 │
│  2. 상태 관리                                                    │
│     ──────────                                                  │
│     • 프로필 정보 (닉네임, 레벨, 통계)                           │
│     • 인벤토리                                                   │
│     • 설정 및 환경설정                                           │
│                                                                 │
│  3. 메시지 라우팅                                                │
│     ────────────                                                │
│     • 클라이언트 ↔ 서버 메시지 중계                              │
│     • 적절한 서비스로 요청 전달                                  │
│     • 응답 집계 및 반환                                          │
│                                                                 │
│  4. 알림 수신                                                    │
│     ──────────                                                  │
│     • 게임 이벤트 수신                                           │
│     • 시스템 공지                                                │
│     • 친구 상태 변경                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 아키텍처 패턴

### 1:1 Player Actor 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                   1:1 Player Actor 패턴                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Client                    Server                              │
│   ──────                    ──────                              │
│                                                                 │
│   ┌─────────┐     WebSocket     ┌──────────────┐               │
│   │Player 1 │◀─────────────────▶│PlayerActor 1 │               │
│   └─────────┘                   └──────┬───────┘               │
│                                        │                        │
│   ┌─────────┐     WebSocket     ┌──────┴───────┐               │
│   │Player 2 │◀─────────────────▶│PlayerActor 2 │               │
│   └─────────┘                   └──────┬───────┘               │
│                                        │                        │
│   ┌─────────┐     WebSocket     ┌──────┴───────┐               │
│   │Player 3 │◀─────────────────▶│PlayerActor 3 │               │
│   └─────────┘                   └──────────────┘               │
│                                                                 │
│   장점:                                                         │
│   • 명확한 책임 분리                                             │
│   • 상태 관리 용이                                               │
│   • 독립적인 생명주기                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Player Actor와 다른 Actor 관계

```
┌─────────────────────────────────────────────────────────────────┐
│                   Actor 간 상호작용                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                        ┌───────────────┐                        │
│                        │  PlayerActor  │                        │
│                        │   (Player1)   │                        │
│                        └───────┬───────┘                        │
│                                │                                │
│      ┌─────────────────────────┼─────────────────────────┐     │
│      │                         │                         │     │
│      ▼                         ▼                         ▼     │
│ ┌──────────┐            ┌──────────┐            ┌──────────┐  │
│ │ GameRoom │            │ ChatRoom │            │  Guild   │  │
│ │  Actor   │            │  Actor   │            │  Actor   │  │
│ └──────────┘            └──────────┘            └──────────┘  │
│      │                         │                         │     │
│      │                         │                         │     │
│      ▼                         ▼                         ▼     │
│ ┌──────────┐            ┌──────────┐            ┌──────────┐  │
│ │ Presence │            │ Friends  │            │ Inventory│  │
│ │  Actor   │            │  Actor   │            │  Actor   │  │
│ └──────────┘            └──────────┘            └──────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 상태 설계

### 플레이어 데이터 모델

```csharp
// 플레이어 영속 상태 (DB 저장)
public class PlayerPersistentState
{
    public string PlayerId { get; set; }
    public string Username { get; set; }
    public string Email { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastLoginAt { get; set; }

    // 게임 데이터
    public int Level { get; set; }
    public long Experience { get; set; }
    public int Currency { get; set; }

    // 통계
    public PlayerStats Stats { get; set; }

    // 인벤토리
    public List<InventoryItem> Inventory { get; set; }

    // 설정
    public PlayerSettings Settings { get; set; }
}

// 플레이어 휘발성 상태 (메모리만)
public class PlayerVolatileState
{
    public bool IsOnline { get; set; }
    public DateTime SessionStartedAt { get; set; }
    public string CurrentGameRoomId { get; set; }
    public string CurrentChatChannelId { get; set; }
    public ConnectionInfo Connection { get; set; }
    public PlayerStatus Status { get; set; }  // Online, Away, Busy, InGame
}

// 연결 정보
public class ConnectionInfo
{
    public string ConnectionId { get; set; }
    public string IPAddress { get; set; }
    public string DeviceType { get; set; }
    public DateTime ConnectedAt { get; set; }
    public IClientProxy ClientProxy { get; set; }  // SignalR 등
}
```

### 메시지 정의

```csharp
// 플레이어 Actor 메시지
public interface IPlayerMessage { }

// 세션 관련
public record Login(string SessionToken, ConnectionInfo Connection) : IPlayerMessage;
public record Logout() : IPlayerMessage;
public record Reconnect(ConnectionInfo NewConnection) : IPlayerMessage;
public record Heartbeat() : IPlayerMessage;

// 상태 조회/변경
public record GetProfile() : IPlayerMessage;
public record UpdateProfile(ProfileUpdate Update) : IPlayerMessage;
public record GetInventory() : IPlayerMessage;
public record UpdateInventory(InventoryChange Change) : IPlayerMessage;

// 게임 관련
public record JoinGameRoom(string RoomId) : IPlayerMessage;
public record LeaveGameRoom() : IPlayerMessage;
public record GameAction(object Action) : IPlayerMessage;

// 소셜
public record SendChatMessage(string ChannelId, string Message) : IPlayerMessage;
public record AddFriend(string FriendId) : IPlayerMessage;
public record RemoveFriend(string FriendId) : IPlayerMessage;

// 알림 수신 (다른 Actor로부터)
public record ReceiveNotification(Notification Notification) : IPlayerMessage;
public record ReceiveGameEvent(GameEvent Event) : IPlayerMessage;
public record FriendStatusChanged(string FriendId, PlayerStatus Status) : IPlayerMessage;
```

---

## Orleans 구현

### Grain 인터페이스

```csharp
public interface IPlayerGrain : IGrainWithStringKey
{
    // 세션 관리
    Task<LoginResult> Login(string sessionToken, ConnectionInfo connection);
    Task Logout();
    Task<bool> Reconnect(ConnectionInfo newConnection);
    Task Heartbeat();

    // 상태 조회
    Task<PlayerProfile> GetProfile();
    Task<PlayerStats> GetStats();
    Task<List<InventoryItem>> GetInventory();
    Task<PlayerStatus> GetStatus();

    // 상태 변경
    Task UpdateProfile(ProfileUpdate update);
    Task<bool> AddToInventory(InventoryItem item);
    Task<bool> RemoveFromInventory(string itemId);
    Task SetStatus(PlayerStatus status);

    // 게임
    Task<JoinResult> JoinGameRoom(string roomId);
    Task LeaveCurrentGame();
    Task<ActionResult> PerformGameAction(object action);

    // 소셜
    Task<List<FriendInfo>> GetFriends();
    Task<bool> AddFriend(string friendId);
    Task<bool> RemoveFriend(string friendId);

    // 알림 (다른 Actor가 호출)
    Task ReceiveNotification(Notification notification);
    Task ReceiveGameEvent(GameEvent gameEvent);
    Task OnFriendStatusChanged(string friendId, PlayerStatus status);
}
```

### Grain 구현

```csharp
public class PlayerGrain : Grain, IPlayerGrain
{
    private readonly IPersistentState<PlayerPersistentState> _persistentState;
    private PlayerVolatileState _volatileState;
    private IDisposable _heartbeatTimer;

    public PlayerGrain(
        [PersistentState("player", "playerStore")]
        IPersistentState<PlayerPersistentState> persistentState)
    {
        _persistentState = persistentState;
        _volatileState = new PlayerVolatileState();
    }

    public override async Task OnActivateAsync(CancellationToken token)
    {
        var playerId = this.GetPrimaryKeyString();

        // 첫 활성화 시 (신규 플레이어)
        if (_persistentState.State == null)
        {
            _persistentState.State = new PlayerPersistentState
            {
                PlayerId = playerId,
                CreatedAt = DateTime.UtcNow,
                Level = 1,
                Experience = 0,
                Currency = 1000,  // 시작 재화
                Stats = new PlayerStats(),
                Inventory = new List<InventoryItem>(),
                Settings = PlayerSettings.Default
            };
            await _persistentState.WriteStateAsync();
        }

        await base.OnActivateAsync(token);
    }

    // ─────────────────────────────────────────────────────────
    // 세션 관리
    // ─────────────────────────────────────────────────────────

    public async Task<LoginResult> Login(string sessionToken, ConnectionInfo connection)
    {
        // 토큰 검증 (Auth 서비스 호출)
        var authGrain = GrainFactory.GetGrain<IAuthGrain>(0);
        var isValid = await authGrain.ValidateSession(sessionToken, this.GetPrimaryKeyString());

        if (!isValid)
            return LoginResult.InvalidSession;

        // 이미 접속 중인 경우 기존 연결 종료
        if (_volatileState.IsOnline && _volatileState.Connection != null)
        {
            await DisconnectExisting("다른 기기에서 로그인");
        }

        // 세션 시작
        _volatileState.IsOnline = true;
        _volatileState.SessionStartedAt = DateTime.UtcNow;
        _volatileState.Connection = connection;
        _volatileState.Status = PlayerStatus.Online;

        // 마지막 로그인 시간 업데이트
        _persistentState.State.LastLoginAt = DateTime.UtcNow;
        await _persistentState.WriteStateAsync();

        // Presence 서비스에 온라인 알림
        var presenceGrain = GrainFactory.GetGrain<IPresenceGrain>(0);
        await presenceGrain.SetOnline(this.GetPrimaryKeyString());

        // 친구들에게 온라인 알림
        await NotifyFriendsStatusChange(PlayerStatus.Online);

        // Heartbeat 타이머 시작
        StartHeartbeatTimer();

        return LoginResult.Success;
    }

    public async Task Logout()
    {
        if (!_volatileState.IsOnline)
            return;

        // 현재 게임에서 나가기
        if (!string.IsNullOrEmpty(_volatileState.CurrentGameRoomId))
        {
            await LeaveCurrentGame();
        }

        // 상태 초기화
        _volatileState.IsOnline = false;
        _volatileState.Connection = null;
        _volatileState.Status = PlayerStatus.Offline;

        // Presence 업데이트
        var presenceGrain = GrainFactory.GetGrain<IPresenceGrain>(0);
        await presenceGrain.SetOffline(this.GetPrimaryKeyString());

        // 친구들에게 오프라인 알림
        await NotifyFriendsStatusChange(PlayerStatus.Offline);

        // 타이머 중지
        _heartbeatTimer?.Dispose();
    }

    public async Task<bool> Reconnect(ConnectionInfo newConnection)
    {
        // 이전 세션 정보가 있는지 확인
        if (_volatileState.SessionStartedAt == default)
            return false;

        // 연결만 업데이트 (상태 유지)
        _volatileState.Connection = newConnection;
        _volatileState.IsOnline = true;

        // Heartbeat 타이머 재시작
        StartHeartbeatTimer();

        // 보류 중인 알림 전송
        await FlushPendingNotifications();

        return true;
    }

    public Task Heartbeat()
    {
        // 연결 유지 확인
        _volatileState.Connection.LastHeartbeat = DateTime.UtcNow;
        return Task.CompletedTask;
    }

    // ─────────────────────────────────────────────────────────
    // 상태 조회/변경
    // ─────────────────────────────────────────────────────────

    public Task<PlayerProfile> GetProfile()
    {
        var state = _persistentState.State;
        return Task.FromResult(new PlayerProfile
        {
            PlayerId = state.PlayerId,
            Username = state.Username,
            Level = state.Level,
            Experience = state.Experience,
            Status = _volatileState.Status
        });
    }

    public async Task<bool> AddToInventory(InventoryItem item)
    {
        var inventory = _persistentState.State.Inventory;

        // 인벤토리 용량 체크
        if (inventory.Count >= MaxInventorySize)
            return false;

        inventory.Add(item);
        await _persistentState.WriteStateAsync();

        // 클라이언트에 알림
        await SendToClient(new InventoryUpdated { Item = item, Action = "add" });

        return true;
    }

    // ─────────────────────────────────────────────────────────
    // 게임
    // ─────────────────────────────────────────────────────────

    public async Task<JoinResult> JoinGameRoom(string roomId)
    {
        // 이미 다른 게임에 있으면 먼저 나가기
        if (!string.IsNullOrEmpty(_volatileState.CurrentGameRoomId))
        {
            await LeaveCurrentGame();
        }

        // 게임룸 입장
        var roomGrain = GrainFactory.GetGrain<IGameRoomGrain>(roomId);
        var result = await roomGrain.Join(
            this.GetPrimaryKeyString(),
            _persistentState.State.Username
        );

        if (result == JoinResult.Success)
        {
            _volatileState.CurrentGameRoomId = roomId;
            _volatileState.Status = PlayerStatus.InGame;

            // 친구들에게 상태 변경 알림
            await NotifyFriendsStatusChange(PlayerStatus.InGame);
        }

        return result;
    }

    public async Task LeaveCurrentGame()
    {
        if (string.IsNullOrEmpty(_volatileState.CurrentGameRoomId))
            return;

        var roomGrain = GrainFactory.GetGrain<IGameRoomGrain>(
            _volatileState.CurrentGameRoomId
        );
        await roomGrain.Leave(this.GetPrimaryKeyString());

        _volatileState.CurrentGameRoomId = null;
        _volatileState.Status = PlayerStatus.Online;

        await NotifyFriendsStatusChange(PlayerStatus.Online);
    }

    // ─────────────────────────────────────────────────────────
    // 알림 수신
    // ─────────────────────────────────────────────────────────

    public async Task ReceiveNotification(Notification notification)
    {
        if (_volatileState.IsOnline && _volatileState.Connection != null)
        {
            await SendToClient(notification);
        }
        else
        {
            // 오프라인이면 저장 (나중에 전달)
            await SavePendingNotification(notification);
        }
    }

    public async Task ReceiveGameEvent(GameEvent gameEvent)
    {
        // 게임 이벤트는 즉시 전달 (저장 안 함)
        if (_volatileState.IsOnline)
        {
            await SendToClient(gameEvent);
        }
    }

    // ─────────────────────────────────────────────────────────
    // 유틸리티
    // ─────────────────────────────────────────────────────────

    private async Task SendToClient(object message)
    {
        if (_volatileState.Connection?.ClientProxy != null)
        {
            await _volatileState.Connection.ClientProxy.SendAsync("Receive", message);
        }
    }

    private async Task NotifyFriendsStatusChange(PlayerStatus newStatus)
    {
        var friendIds = _persistentState.State.FriendIds ?? new List<string>();

        foreach (var friendId in friendIds)
        {
            var friendGrain = GrainFactory.GetGrain<IPlayerGrain>(friendId);
            // Fire and forget
            friendGrain.OnFriendStatusChanged(this.GetPrimaryKeyString(), newStatus);
        }
    }

    private void StartHeartbeatTimer()
    {
        _heartbeatTimer?.Dispose();
        _heartbeatTimer = RegisterTimer(
            CheckHeartbeat,
            null,
            TimeSpan.FromSeconds(30),
            TimeSpan.FromSeconds(30)
        );
    }

    private async Task CheckHeartbeat(object _)
    {
        if (!_volatileState.IsOnline)
            return;

        var lastHeartbeat = _volatileState.Connection?.LastHeartbeat ?? DateTime.MinValue;
        if (DateTime.UtcNow - lastHeartbeat > TimeSpan.FromMinutes(2))
        {
            // 연결 끊김으로 판단
            await Logout();
        }
    }
}
```

---

## C++ CAF 구현 예시

```cpp
#include <caf/all.hpp>
#include <string>
#include <vector>
#include <optional>

// 플레이어 상태
struct player_persistent_state {
    std::string player_id;
    std::string username;
    int level = 1;
    long experience = 0;
    int currency = 1000;
    std::vector<inventory_item> inventory;
};

struct player_volatile_state {
    bool is_online = false;
    std::optional<connection_info> connection;
    std::optional<std::string> current_room_id;
    player_status status = player_status::offline;
};

struct player_state {
    player_persistent_state persistent;
    player_volatile_state volatile_;
};

// 메시지 타입
using login_atom = atom_constant<atom("login")>;
using logout_atom = atom_constant<atom("logout")>;
using heartbeat_atom = atom_constant<atom("heartbeat")>;
using join_room_atom = atom_constant<atom("joinroom")>;
using leave_room_atom = atom_constant<atom("leaveroom")>;
using get_profile_atom = atom_constant<atom("getprof")>;

// 플레이어 Actor
behavior player_actor(stateful_actor<player_state>* self,
                      const std::string& player_id) {
    // 초기화
    self->state.persistent.player_id = player_id;

    return {
        // 로그인
        [=](login_atom, const std::string& token,
            connection_info conn) -> login_result {
            auto& s = self->state;

            // 토큰 검증 (동기 호출 또는 request-then)
            // 여기서는 간단히 성공 가정

            // 이미 접속 중이면 기존 연결 종료
            if (s.volatile_.is_online && s.volatile_.connection) {
                // 기존 클라이언트에 알림
                self->send(*s.volatile_.connection->client,
                          disconnected{"다른 기기에서 로그인"});
            }

            s.volatile_.is_online = true;
            s.volatile_.connection = conn;
            s.volatile_.status = player_status::online;

            // Heartbeat 타이머
            self->delayed_send(self, std::chrono::seconds(30),
                             check_heartbeat_atom_v);

            return login_result::success;
        },

        // 로그아웃
        [=](logout_atom) {
            auto& s = self->state;

            if (!s.volatile_.is_online)
                return;

            // 게임룸에서 나가기
            if (s.volatile_.current_room_id) {
                // room actor에 leave 메시지 전송
            }

            s.volatile_.is_online = false;
            s.volatile_.connection = std::nullopt;
            s.volatile_.status = player_status::offline;
        },

        // Heartbeat
        [=](heartbeat_atom) {
            auto& s = self->state;
            if (s.volatile_.connection) {
                s.volatile_.connection->last_heartbeat =
                    std::chrono::steady_clock::now();
            }
        },

        // 프로필 조회
        [=](get_profile_atom) -> player_profile {
            auto& s = self->state;
            return player_profile{
                s.persistent.player_id,
                s.persistent.username,
                s.persistent.level,
                s.persistent.experience,
                s.volatile_.status
            };
        },

        // 게임룸 입장
        [=](join_room_atom, const std::string& room_id) {
            auto& s = self->state;

            // 기존 룸에서 나가기
            if (s.volatile_.current_room_id) {
                // leave 처리
            }

            // 룸 actor에 join 요청
            auto room = self->system().registry().get<actor>(room_id);
            self->request(room, std::chrono::seconds(5),
                         join_atom_v, self, s.persistent.username)
            .then([=](join_result result) {
                if (result == join_result::success) {
                    self->state.volatile_.current_room_id = room_id;
                    self->state.volatile_.status = player_status::in_game;
                }
            });
        },

        // 알림 수신
        [=](notification notif) {
            auto& s = self->state;
            if (s.volatile_.is_online && s.volatile_.connection) {
                self->send(*s.volatile_.connection->client, notif);
            }
        },

        // Heartbeat 체크
        [=](check_heartbeat_atom) {
            auto& s = self->state;
            if (!s.volatile_.is_online)
                return;

            auto now = std::chrono::steady_clock::now();
            auto last = s.volatile_.connection->last_heartbeat;

            if (now - last > std::chrono::minutes(2)) {
                // 타임아웃 - 로그아웃 처리
                self->send(self, logout_atom_v);
            } else {
                // 다음 체크 예약
                self->delayed_send(self, std::chrono::seconds(30),
                                 check_heartbeat_atom_v);
            }
        }
    };
}
```

---

## 설계 패턴

### 1. Virtual Actor (Orleans Grain)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Virtual Actor 패턴                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  특징:                                                          │
│  ──────                                                         │
│  • Actor가 항상 존재하는 것처럼 동작                             │
│  • 첫 호출 시 자동 활성화                                        │
│  • 비활성 시 자동 비활성화                                       │
│  • 개발자가 생명주기 관리 불필요                                 │
│                                                                 │
│  플레이어 Actor에 적합한 이유:                                   │
│  ────────────────────────────                                   │
│  • 플레이어 ID로 언제든 접근 가능                                │
│  • 오프라인 플레이어에게도 메시지 전송 가능                      │
│  • 재접속 시 상태 자동 복원                                      │
│                                                                 │
│  코드 예시:                                                      │
│  ──────────                                                      │
│  // 플레이어가 온라인이든 오프라인이든 동작                      │
│  var player = grainFactory.GetGrain<IPlayerGrain>(playerId);    │
│  await player.ReceiveNotification(notification);                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 연결과 Actor 분리

```
┌─────────────────────────────────────────────────────────────────┐
│                  연결-Actor 분리 패턴                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────────────────────────────────────────────────┐     │
│   │                   Connection Layer                    │     │
│   │    (WebSocket Hub, SignalR, Socket Server)           │     │
│   └─────────────────────────┬────────────────────────────┘     │
│                             │                                   │
│                             │ ConnectionId                      │
│                             │ 매핑                              │
│                             ▼                                   │
│   ┌──────────────────────────────────────────────────────┐     │
│   │                    Player Actor                       │     │
│   │                                                       │     │
│   │  • 연결 정보 보유 (but 연결 직접 관리 X)              │     │
│   │  • 메시지 처리 로직                                   │     │
│   │  • 상태 관리                                          │     │
│   │                                                       │     │
│   └──────────────────────────────────────────────────────┘     │
│                                                                 │
│   이점:                                                         │
│   ──────                                                        │
│   • 연결 끊김과 Actor 상태 분리                                 │
│   • 재접속 시 새 연결 할당만 하면 됨                            │
│   • 단위 테스트 용이                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3. 오프라인 메시지 큐

```csharp
// 오프라인 플레이어를 위한 메시지 큐
public async Task ReceiveNotification(Notification notification)
{
    if (_volatileState.IsOnline)
    {
        // 온라인: 즉시 전달
        await SendToClient(notification);
    }
    else
    {
        // 오프라인: 저장 후 나중에 전달
        if (notification.ShouldPersist)
        {
            _persistentState.State.PendingNotifications.Add(new PendingNotification
            {
                Notification = notification,
                CreatedAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddDays(7)
            });
            await _persistentState.WriteStateAsync();
        }
    }
}

// 로그인 시 보류 알림 전달
private async Task FlushPendingNotifications()
{
    var pending = _persistentState.State.PendingNotifications
        .Where(n => n.ExpiresAt > DateTime.UtcNow)
        .OrderBy(n => n.CreatedAt)
        .ToList();

    foreach (var notification in pending)
    {
        await SendToClient(notification.Notification);
    }

    _persistentState.State.PendingNotifications.Clear();
    await _persistentState.WriteStateAsync();
}
```

---

## 성능 고려사항

### 1. 상태 크기 관리

```
┌─────────────────────────────────────────────────────────────────┐
│                    상태 크기 가이드라인                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ 플레이어 Actor에 포함:                                       │
│  • 기본 프로필 (수 KB)                                          │
│  • 현재 세션 정보                                                │
│  • 자주 접근하는 설정                                            │
│                                                                 │
│  ⚠️ 별도 Actor로 분리 권장:                                      │
│  • 대용량 인벤토리 (수천 개 아이템)                              │
│  • 상세 통계/히스토리                                            │
│  • 메일/메시지 목록                                              │
│                                                                 │
│  분리 예시:                                                      │
│  ──────────                                                      │
│  IPlayerGrain (player-{id})      → 핵심 상태                    │
│  IInventoryGrain (inv-{id})      → 인벤토리                     │
│  IPlayerStatsGrain (stats-{id})  → 상세 통계                    │
│  IMailboxGrain (mail-{id})       → 메일함                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 메시지 처리 최적화

```csharp
// 배치 처리
public async Task ProcessActions(List<GameAction> actions)
{
    var results = new List<ActionResult>();

    foreach (var action in actions)
    {
        results.Add(await ProcessSingleAction(action));
    }

    // 한 번에 상태 저장
    await _persistentState.WriteStateAsync();

    // 한 번에 클라이언트에 전송
    await SendToClient(new BatchResults(results));
}

// 쓰기 지연 (Write-Behind)
private readonly List<StateChange> _pendingChanges = new();
private IDisposable _flushTimer;

public async Task UpdateStats(StatChange change)
{
    _pendingChanges.Add(change);

    // 타이머가 없으면 시작 (100ms 후 플러시)
    _flushTimer ??= RegisterTimer(
        FlushChanges,
        null,
        TimeSpan.FromMilliseconds(100),
        TimeSpan.MaxValue
    );
}

private async Task FlushChanges(object _)
{
    if (_pendingChanges.Count > 0)
    {
        ApplyChanges(_pendingChanges);
        await _persistentState.WriteStateAsync();
        _pendingChanges.Clear();
    }
    _flushTimer = null;
}
```

---

## 테스트 전략

```csharp
[TestClass]
public class PlayerActorTests
{
    [Test]
    public async Task Login_ShouldSetOnlineStatus()
    {
        // Arrange
        var player = await GetGrain<IPlayerGrain>("test-player");

        // Act
        var result = await player.Login("valid-token", new ConnectionInfo());

        // Assert
        Assert.AreEqual(LoginResult.Success, result);
        var status = await player.GetStatus();
        Assert.AreEqual(PlayerStatus.Online, status);
    }

    [Test]
    public async Task Login_WithExistingSession_ShouldDisconnectPrevious()
    {
        // Arrange
        var player = await GetGrain<IPlayerGrain>("test-player");
        var firstConn = new MockConnectionInfo("conn1");
        var secondConn = new MockConnectionInfo("conn2");

        await player.Login("token", firstConn);

        // Act
        await player.Login("token", secondConn);

        // Assert
        Assert.IsTrue(firstConn.WasDisconnected);
    }

    [Test]
    public async Task ReceiveNotification_WhenOffline_ShouldQueue()
    {
        // Arrange
        var player = await GetGrain<IPlayerGrain>("test-player");
        // 로그인하지 않음 (오프라인)

        // Act
        await player.ReceiveNotification(new Notification("Test"));

        // Assert (로그인 후 확인)
        await player.Login("token", new ConnectionInfo());
        // 보류된 알림이 전달되었는지 확인
    }
}
```

---

## 다음 단계

- [state-persistence.md](./state-persistence.md) - 상태 영속화 전략
- [game-room-actor.md](./game-room-actor.md) - 게임룸 Actor 설계
- [../07-realtime-game/README.md](../07-realtime-game/README.md) - 실시간 게임 적합성
