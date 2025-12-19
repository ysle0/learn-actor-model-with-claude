# 06. MMORPG - Zone/Shard 아키텍처 예제

> Actor Model을 활용한 MMORPG 서버 아키텍처 예제

## 개요

이 예제는 MMORPG 서버의 핵심 구성 요소를 Actor Model로 구현합니다:

- **Zone Actor**: 게임 세계의 영역 관리
- **Player Actor**: 개별 플레이어 상태 관리
- **Monster Actor**: NPC/몬스터 AI
- **World Manager**: Zone 간 조율

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                      World Manager Actor                        │
├─────────────────────────────────────────────────────────────────┤
│                              │                                  │
│         ┌────────────────────┼────────────────────┐            │
│         │                    │                    │            │
│    ┌────┴────┐          ┌────┴────┐         ┌────┴────┐       │
│    │ Zone 1  │◀────────▶│ Zone 2  │◀───────▶│ Zone 3  │       │
│    │ (Town)  │          │ (Forest)│         │(Dungeon)│       │
│    └────┬────┘          └────┬────┘         └────┬────┘       │
│         │                    │                    │            │
│    ┌────┴────┐          ┌────┴────┐         ┌────┴────┐       │
│    │Players  │          │Players  │         │Players  │       │
│    │NPCs     │          │Monsters │         │Monsters │       │
│    │Shops    │          │Items    │         │Boss     │       │
│    └─────────┘          └─────────┘         └─────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 주요 Actor 설명

### Zone Actor

```
책임:
─────
• 해당 영역의 모든 엔티티 관리
• 관심 영역(AOI) 기반 업데이트 전파
• Zone 간 이동 처리
• 몬스터 스폰/리스폰

메시지:
───────
• PlayerEnter: 플레이어 입장
• PlayerLeave: 플레이어 퇴장
• EntityMove: 엔티티 이동
• Combat: 전투 처리
• Tick: 주기적 업데이트
```

### Player Actor

```
책임:
─────
• 플레이어 상태 (HP, MP, 레벨, 경험치)
• 인벤토리 관리
• 스킬/버프 상태
• 퀘스트 진행 상황

메시지:
───────
• Move: 이동 명령
• Attack: 공격
• UseItem: 아이템 사용
• Chat: 채팅
• SaveState: 상태 저장
```

### Monster Actor

```
책임:
─────
• AI 행동 결정
• 어그로 관리
• 스킬 사용
• 드롭 아이템 생성

메시지:
───────
• Tick: AI 업데이트
• TakeDamage: 피해 받음
• Die: 사망 처리
• Respawn: 리스폰
```

## 핵심 패턴

### 1. 관심 영역 (Area of Interest)

```
플레이어 P의 시야 범위 내 엔티티만 업데이트 전송

     ┌───────────────────┐
     │    Zone Actor     │
     │                   │
     │  ○  ○  ●  ○  ○   │   ○ = 시야 밖
     │  ○ [   P   ] ○    │   ● = 시야 내
     │  ○  ●  ●  ●  ○   │   P = 플레이어
     │  ○  ○  ●  ○  ○   │
     └───────────────────┘

→ P에게는 ● 엔티티만 업데이트 전송
→ 대역폭 및 처리량 최적화
```

### 2. Zone 간 이동 (Handoff)

```
Zone A                    Zone B
  │                         │
  │ PlayerLeave(player) ───▶│
  │                         │
  │◀─── Acknowledge ────────│
  │                         │
  │   [Player State 전송]   │
  │ ──────────────────────▶ │
  │                         │
  │                         │ PlayerEnter(player)
```

### 3. 분산 전투

```
┌─────────┐     Attack      ┌─────────┐
│ Player  │ ──────────────▶ │ Monster │
│  Actor  │                 │  Actor  │
└─────────┘                 └────┬────┘
      ▲                          │
      │      Damage Event        │
      └──────────────────────────┘
```

## 언어별 구현

| 언어 | 파일 | 특징 |
|------|------|------|
| TypeScript | [typescript/](./typescript/) | 개념 이해용 |
| C++ | [cpp/](./cpp/) | CAF 기반 고성능 |
| C# | [csharp/](./csharp/) | Orleans 기반 |
| Go | [go/](./go/) | Proto.Actor 기반 |

## 실행 예시

```bash
# TypeScript
cd typescript && npm install && npm start

# C++ (CAF 필요)
cd cpp && mkdir build && cd build && cmake .. && make && ./mmorpg_server

# C# (dotnet 필요)
cd csharp && dotnet run

# Go
cd go && go run .
```

## 확장 고려사항

### 스케일링

```
┌────────────────────────────────────────────────────────────────┐
│                     Load Balancer                              │
└────────────────────────────────────────────────────────────────┘
         │              │              │              │
    ┌────┴────┐    ┌────┴────┐    ┌────┴────┐    ┌────┴────┐
    │ Server 1│    │ Server 2│    │ Server 3│    │ Server 4│
    │ Zone 1-3│    │ Zone 4-6│    │ Zone 7-9│    │Zone10-12│
    └─────────┘    └─────────┘    └─────────┘    └─────────┘

• 각 서버가 여러 Zone 담당
• Zone 간 통신은 메시지로
• 동적 리밸런싱 가능
```

### 상태 영속화

```
Player Actor
     │
     ├── 주기적 저장 (5분마다)
     │
     ├── 중요 이벤트 시 즉시 저장
     │   • 레벨업
     │   • 아이템 획득
     │   • 퀘스트 완료
     │
     └── 로그아웃 시 최종 저장
```

## 참고 자료

- [mir2x - C++ MMORPG](https://github.com/etorth/mir2x)
- [NoahGameFrame](https://github.com/ketoo/NoahGameFrame)
- [Orleans Gaming Sample](https://github.com/dotnet/orleans/tree/main/samples)
