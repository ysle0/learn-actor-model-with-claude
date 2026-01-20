# 04. Game Room - 게임 룸 Actor 패턴

> 멀티플레이어 게임 룸의 Actor 기반 구현 예제

## 구현 목표

```
Game Room System
────────────────
• RoomActor: 게임 룸 상태 관리
• PlayerActor: 플레이어 세션 관리
• 입장/퇴장/준비 상태 처리
• 게임 시작/종료 로직
• 실시간 상태 브로드캐스트
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
│                    게임 룸 시스템 구조                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    ┌─────────────────┐                         │
│                    │  RoomManager    │                         │
│                    │  (Supervisor)   │                         │
│                    └────────┬────────┘                         │
│                             │                                   │
│         ┌───────────────────┼───────────────────┐              │
│         │                   │                   │               │
│  ┌──────▼──────┐     ┌──────▼──────┐     ┌──────▼──────┐      │
│  │  Room-001   │     │  Room-002   │     │  Room-003   │      │
│  │  (Playing)  │     │  (Waiting)  │     │  (Waiting)  │      │
│  └──────┬──────┘     └──────┬──────┘     └─────────────┘      │
│         │                   │                                   │
│    ┌────┼────┐         ┌────┼────┐                             │
│    │    │    │         │    │    │                             │
│  ┌─▼─┐┌─▼─┐┌─▼─┐     ┌─▼─┐┌─▼─┐┌─▼─┐                         │
│  │P1 ││P2 ││P3 │     │P4 ││P5 ││P6 │  Players                 │
│  └───┘└───┘└───┘     └───┘└───┘└───┘                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 상태 전이

```
┌─────────────────────────────────────────────────────────────────┐
│                    룸 상태 전이                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│     ┌──────────┐                                               │
│     │  EMPTY   │◀────────────────────────────────┐             │
│     └────┬─────┘                                 │             │
│          │ 첫 플레이어 입장                       │             │
│          ▼                                       │             │
│     ┌──────────┐                                 │             │
│     │ WAITING  │◀──────────────────┐             │             │
│     └────┬─────┘                   │             │             │
│          │ 모두 Ready && 최소 인원  │             │             │
│          ▼                         │             │             │
│     ┌──────────┐                   │             │             │
│     │ STARTING │                   │             │             │
│     └────┬─────┘                   │             │             │
│          │ 카운트다운 완료          │             │             │
│          ▼                         │             │             │
│     ┌──────────┐                   │             │             │
│     │ PLAYING  │───────────────────┘             │             │
│     └────┬─────┘  게임 종료/플레이어 이탈         │             │
│          │                                       │             │
│          ▼                                       │             │
│     ┌──────────┐                                 │             │
│     │ FINISHED │─────────────────────────────────┘             │
│     └──────────┘  리셋 후                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 메시지 흐름

```
Player                    Room                    Other Players
   │                        │                           │
   │── JoinRoom ──────────▶│                           │
   │                        │── PlayerJoined ─────────▶│
   │◀─── JoinSuccess ──────│                           │
   │                        │                           │
   │── SetReady(true) ────▶│                           │
   │                        │── PlayerReady ──────────▶│
   │                        │                           │
   │                        │◀── All Ready ──          │
   │◀─── GameStarting ─────│── GameStarting ─────────▶│
   │                        │                           │
   │── GameAction ────────▶│                           │
   │                        │── BroadcastAction ──────▶│
   │◀─ BroadcastAction ────│                           │
   │                        │                           │
```

## 핵심 개념

### 1. Room Actor 상태

```typescript
interface RoomState {
  roomId: string;
  status: 'waiting' | 'starting' | 'playing' | 'finished';
  players: Map<string, PlayerInfo>;
  maxPlayers: number;
  minPlayers: number;
  gameData: any;
}
```

### 2. Player Actor 상태

```typescript
interface PlayerState {
  playerId: string;
  name: string;
  isReady: boolean;
  currentRoom?: string;
  score: number;
}
```

## 학습 포인트

1. **상태 격리**: 각 룸이 독립적인 상태 보유
2. **동시성 관리**: 입장/퇴장 레이스 컨디션 방지
3. **브로드캐스트 패턴**: 룸 내 모든 플레이어에게 메시지 전파
4. **생명주기 관리**: 룸 생성/삭제 자동화

## 실행 방법

### TypeScript
```bash
cd typescript
npx ts-node game-room.ts
```

### Go
```bash
cd go
go run game-room.go
```

### C#
```bash
cd csharp
dotnet run
```

### C++
```bash
cd cpp
g++ -std=c++17 game-room.cpp -o game-room -pthread
./game-room
```
