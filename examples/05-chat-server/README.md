# 05. Chat Server - 채팅 서버 Actor 패턴

> 실시간 채팅 서버의 Actor 기반 구현 예제

## 구현 목표

```
Chat Server System
──────────────────
• ChatRoomActor: 채팅방 관리
• UserSessionActor: 사용자 세션 관리
• 입장/퇴장/메시지 브로드캐스트
• 귓속말(DM) 기능
• 채팅 이력 관리
```

## 각 언어별 구현

| 언어 | 프레임워크 | 파일 |
|------|-----------|------|
| TypeScript | 직접 구현 | [typescript/](./typescript/) |
| C++ | CAF 스타일 | [cpp/](./cpp/) |
| C# | Orleans 스타일 | [csharp/](./csharp/) |
| Go | Proto.Actor 스타일 | [go/](./go/) |

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                    채팅 서버 구조                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    ┌─────────────────┐                         │
│                    │  ChatManager    │                         │
│                    │  (Supervisor)   │                         │
│                    └────────┬────────┘                         │
│                             │                                   │
│         ┌───────────────────┼───────────────────┐              │
│         │                   │                   │               │
│  ┌──────▼──────┐     ┌──────▼──────┐     ┌──────▼──────┐      │
│  │  General    │     │  Tech-Talk  │     │  Random     │      │
│  │  ChatRoom   │     │  ChatRoom   │     │  ChatRoom   │      │
│  └──────┬──────┘     └──────┬──────┘     └─────────────┘      │
│         │                   │                                   │
│    ┌────┴────┐         ┌────┴────┐                             │
│  ┌─▼──┐ ┌──▼─┐       ┌─▼──┐ ┌──▼─┐                           │
│  │User│ │User│       │User│ │User│  User Sessions             │
│  │ A  │ │ B  │       │ C  │ │ D  │                            │
│  └────┘ └────┘       └────┘ └────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 메시지 흐름

```
User A              ChatRoom              User B, C, D
   │                   │                      │
   │── JoinRoom ──────▶│                      │
   │                   │── UserJoined ───────▶│
   │◀─ JoinSuccess ───│                      │
   │                   │                      │
   │── SendMessage ───▶│                      │
   │                   │── BroadcastMsg ─────▶│
   │                   │                      │
   │── DirectMessage ─▶│                      │
   │                   │── PrivateMsg ───────▶│ (only User B)
   │                   │                      │
   │── LeaveRoom ─────▶│                      │
   │                   │── UserLeft ─────────▶│
   │                   │                      │
```

## 핵심 개념

### 1. ChatRoom Actor

```typescript
interface ChatRoomState {
  roomId: string;
  name: string;
  users: Map<string, UserInfo>;
  messageHistory: ChatMessage[];
  maxHistorySize: number;
}
```

### 2. UserSession Actor

```typescript
interface UserSessionState {
  sessionId: string;
  username: string;
  currentRoom?: string;
  status: 'online' | 'away' | 'offline';
}
```

### 3. 메시지 타입

```typescript
interface ChatMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: Date;
  type: 'public' | 'private' | 'system';
}
```

## 학습 포인트

1. **Pub/Sub 패턴**: 채팅방 구독자에게 메시지 전파
2. **세션 관리**: 사용자별 상태 및 연결 관리
3. **메시지 이력**: 제한된 크기의 메시지 버퍼
4. **1:1 메시지**: 특정 사용자에게만 메시지 전송

## 실행 방법

### TypeScript
```bash
cd typescript
npx ts-node chat-server.ts
```

### Go
```bash
cd go
go run chat-server.go
```

### C#
```bash
cd csharp
dotnet run
```

### C++
```bash
cd cpp
g++ -std=c++17 chat-server.cpp -o chat-server -pthread
./chat-server
```
