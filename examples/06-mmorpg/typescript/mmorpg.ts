/**
 * MMORPG Server Architecture - TypeScript Example
 *
 * Actor Model을 활용한 MMORPG 서버의 개념적 구현
 * 실제 프로덕션에서는 전용 프레임워크 사용 권장
 */

// ============================================
// Types & Interfaces
// ============================================

interface Position {
  x: number;
  y: number;
}

interface Entity {
  id: string;
  position: Position;
  type: 'player' | 'monster' | 'npc' | 'item';
}

interface PlayerState {
  id: string;
  name: string;
  position: Position;
  health: number;
  maxHealth: number;
  level: number;
  exp: number;
  inventory: string[];
}

interface MonsterState {
  id: string;
  type: string;
  position: Position;
  health: number;
  maxHealth: number;
  aggroTarget: string | null;
}

// ============================================
// Message Types
// ============================================

// Zone Messages
type ZoneMessage =
  | { type: 'PLAYER_ENTER'; player: PlayerState }
  | { type: 'PLAYER_LEAVE'; playerId: string }
  | { type: 'ENTITY_MOVE'; entityId: string; position: Position }
  | { type: 'ATTACK'; attackerId: string; targetId: string; damage: number }
  | { type: 'TICK'; deltaTime: number }
  | { type: 'SPAWN_MONSTER'; monsterType: string; position: Position }
  | { type: 'GET_NEARBY_ENTITIES'; position: Position; radius: number; replyTo: (entities: Entity[]) => void };

// Player Messages
type PlayerMessage =
  | { type: 'MOVE'; direction: Position }
  | { type: 'ATTACK'; targetId: string }
  | { type: 'TAKE_DAMAGE'; amount: number; attackerId: string }
  | { type: 'GAIN_EXP'; amount: number }
  | { type: 'USE_ITEM'; itemId: string }
  | { type: 'GET_STATE'; replyTo: (state: PlayerState) => void };

// Monster Messages
type MonsterMessage =
  | { type: 'TICK'; deltaTime: number }
  | { type: 'TAKE_DAMAGE'; amount: number; attackerId: string }
  | { type: 'SET_AGGRO'; targetId: string }
  | { type: 'DIE' }
  | { type: 'RESPAWN'; position: Position };

// ============================================
// Actor Base Class
// ============================================

abstract class Actor<T> {
  protected mailbox: T[] = [];
  private processing = false;

  send(message: T): void {
    this.mailbox.push(message);
    this.processNext();
  }

  protected abstract receive(message: T): void | Promise<void>;

  private async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.mailbox.length > 0) {
      const message = this.mailbox.shift()!;
      try {
        await this.receive(message);
      } catch (error) {
        console.error(`[${this.constructor.name}] Error:`, error);
      }
    }

    this.processing = false;
  }
}

// ============================================
// Zone Actor
// ============================================

class ZoneActor extends Actor<ZoneMessage> {
  private zoneId: string;
  private players: Map<string, PlayerActor> = new Map();
  private monsters: Map<string, MonsterActor> = new Map();
  private VIEW_RADIUS = 100;

  constructor(zoneId: string) {
    super();
    this.zoneId = zoneId;
    console.log(`[Zone ${zoneId}] Created`);
  }

  protected receive(message: ZoneMessage): void {
    switch (message.type) {
      case 'PLAYER_ENTER':
        this.handlePlayerEnter(message.player);
        break;

      case 'PLAYER_LEAVE':
        this.handlePlayerLeave(message.playerId);
        break;

      case 'ENTITY_MOVE':
        this.handleEntityMove(message.entityId, message.position);
        break;

      case 'ATTACK':
        this.handleAttack(message.attackerId, message.targetId, message.damage);
        break;

      case 'TICK':
        this.handleTick(message.deltaTime);
        break;

      case 'SPAWN_MONSTER':
        this.spawnMonster(message.monsterType, message.position);
        break;

      case 'GET_NEARBY_ENTITIES':
        const entities = this.getNearbyEntities(message.position, message.radius);
        message.replyTo(entities);
        break;
    }
  }

  private handlePlayerEnter(playerState: PlayerState): void {
    const player = new PlayerActor(playerState, this);
    this.players.set(playerState.id, player);
    console.log(`[Zone ${this.zoneId}] Player ${playerState.name} entered`);

    // 주변 플레이어들에게 알림
    this.broadcastToNearby(playerState.position, {
      type: 'PLAYER_APPEARED',
      player: playerState
    });
  }

  private handlePlayerLeave(playerId: string): void {
    const player = this.players.get(playerId);
    if (player) {
      this.players.delete(playerId);
      console.log(`[Zone ${this.zoneId}] Player ${playerId} left`);
    }
  }

  private handleEntityMove(entityId: string, position: Position): void {
    // AOI 기반 업데이트 전파
    this.broadcastToNearby(position, {
      type: 'ENTITY_MOVED',
      entityId,
      position
    });
  }

  private handleAttack(attackerId: string, targetId: string, damage: number): void {
    const target = this.monsters.get(targetId) || this.players.get(targetId);
    if (target) {
      target.send({ type: 'TAKE_DAMAGE', amount: damage, attackerId });
    }
  }

  private handleTick(deltaTime: number): void {
    // 모든 몬스터 AI 업데이트
    for (const [_, monster] of this.monsters) {
      monster.send({ type: 'TICK', deltaTime });
    }
  }

  private spawnMonster(monsterType: string, position: Position): void {
    const id = `monster_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const monster = new MonsterActor({
      id,
      type: monsterType,
      position,
      health: 100,
      maxHealth: 100,
      aggroTarget: null
    }, this);
    this.monsters.set(id, monster);
    console.log(`[Zone ${this.zoneId}] Spawned ${monsterType} at (${position.x}, ${position.y})`);
  }

  private getNearbyEntities(position: Position, radius: number): Entity[] {
    const entities: Entity[] = [];

    for (const [id, _] of this.players) {
      // 실제로는 위치 기반 필터링
      entities.push({ id, position: { x: 0, y: 0 }, type: 'player' });
    }

    for (const [id, _] of this.monsters) {
      entities.push({ id, position: { x: 0, y: 0 }, type: 'monster' });
    }

    return entities;
  }

  private broadcastToNearby(position: Position, event: any): void {
    // 관심 영역 내의 플레이어들에게만 전송
    for (const [_, player] of this.players) {
      // 실제로는 거리 계산 필요
      // player.sendToClient(event);
    }
  }

  // 몬스터 사망 처리
  removeMonster(monsterId: string): void {
    this.monsters.delete(monsterId);
  }
}

// ============================================
// Player Actor
// ============================================

class PlayerActor extends Actor<PlayerMessage> {
  private state: PlayerState;
  private zone: ZoneActor;

  constructor(state: PlayerState, zone: ZoneActor) {
    super();
    this.state = state;
    this.zone = zone;
  }

  protected receive(message: PlayerMessage): void {
    switch (message.type) {
      case 'MOVE':
        this.handleMove(message.direction);
        break;

      case 'ATTACK':
        this.handleAttack(message.targetId);
        break;

      case 'TAKE_DAMAGE':
        this.handleTakeDamage(message.amount, message.attackerId);
        break;

      case 'GAIN_EXP':
        this.handleGainExp(message.amount);
        break;

      case 'USE_ITEM':
        this.handleUseItem(message.itemId);
        break;

      case 'GET_STATE':
        message.replyTo(this.state);
        break;
    }
  }

  private handleMove(direction: Position): void {
    this.state.position.x += direction.x;
    this.state.position.y += direction.y;

    this.zone.send({
      type: 'ENTITY_MOVE',
      entityId: this.state.id,
      position: this.state.position
    });
  }

  private handleAttack(targetId: string): void {
    const damage = 10 + this.state.level * 2;
    this.zone.send({
      type: 'ATTACK',
      attackerId: this.state.id,
      targetId,
      damage
    });
  }

  private handleTakeDamage(amount: number, attackerId: string): void {
    this.state.health -= amount;
    console.log(`[Player ${this.state.name}] Took ${amount} damage, HP: ${this.state.health}/${this.state.maxHealth}`);

    if (this.state.health <= 0) {
      this.handleDeath();
    }
  }

  private handleGainExp(amount: number): void {
    this.state.exp += amount;
    const expToLevel = this.state.level * 100;

    if (this.state.exp >= expToLevel) {
      this.state.exp -= expToLevel;
      this.state.level++;
      this.state.maxHealth += 10;
      this.state.health = this.state.maxHealth;
      console.log(`[Player ${this.state.name}] Leveled up! Now level ${this.state.level}`);
    }
  }

  private handleUseItem(itemId: string): void {
    const index = this.state.inventory.indexOf(itemId);
    if (index !== -1) {
      this.state.inventory.splice(index, 1);
      // 아이템 효과 적용
      console.log(`[Player ${this.state.name}] Used item ${itemId}`);
    }
  }

  private handleDeath(): void {
    console.log(`[Player ${this.state.name}] Died!`);
    // 부활 처리, 경험치 페널티 등
  }
}

// ============================================
// Monster Actor
// ============================================

class MonsterActor extends Actor<MonsterMessage> {
  private state: MonsterState;
  private zone: ZoneActor;
  private respawnTime = 30000; // 30초

  constructor(state: MonsterState, zone: ZoneActor) {
    super();
    this.state = state;
    this.zone = zone;
  }

  protected receive(message: MonsterMessage): void {
    switch (message.type) {
      case 'TICK':
        this.handleTick(message.deltaTime);
        break;

      case 'TAKE_DAMAGE':
        this.handleTakeDamage(message.amount, message.attackerId);
        break;

      case 'SET_AGGRO':
        this.state.aggroTarget = message.targetId;
        break;

      case 'DIE':
        this.handleDeath();
        break;

      case 'RESPAWN':
        this.handleRespawn(message.position);
        break;
    }
  }

  private handleTick(deltaTime: number): void {
    if (this.state.aggroTarget) {
      // 타겟 추적 및 공격 AI
      this.attackTarget();
    } else {
      // 순찰 AI
      this.patrol();
    }
  }

  private handleTakeDamage(amount: number, attackerId: string): void {
    this.state.health -= amount;
    console.log(`[Monster ${this.state.id}] Took ${amount} damage, HP: ${this.state.health}`);

    // 어그로 설정
    if (!this.state.aggroTarget) {
      this.state.aggroTarget = attackerId;
    }

    if (this.state.health <= 0) {
      this.send({ type: 'DIE' });
    }
  }

  private handleDeath(): void {
    console.log(`[Monster ${this.state.id}] Died!`);

    // 드롭 아이템 생성
    // 경험치 분배

    this.zone.removeMonster(this.state.id);

    // 리스폰 예약
    setTimeout(() => {
      this.zone.send({
        type: 'SPAWN_MONSTER',
        monsterType: this.state.type,
        position: this.state.position
      });
    }, this.respawnTime);
  }

  private handleRespawn(position: Position): void {
    this.state.health = this.state.maxHealth;
    this.state.position = position;
    this.state.aggroTarget = null;
  }

  private attackTarget(): void {
    // 타겟 공격 로직
  }

  private patrol(): void {
    // 순찰 로직
  }
}

// ============================================
// World Manager
// ============================================

class WorldManager {
  private zones: Map<string, ZoneActor> = new Map();

  constructor() {
    // Zone 생성
    this.zones.set('town', new ZoneActor('town'));
    this.zones.set('forest', new ZoneActor('forest'));
    this.zones.set('dungeon', new ZoneActor('dungeon'));
  }

  getZone(zoneId: string): ZoneActor | undefined {
    return this.zones.get(zoneId);
  }

  // Zone 간 이동 처리
  transferPlayer(playerId: string, fromZoneId: string, toZoneId: string): void {
    const fromZone = this.zones.get(fromZoneId);
    const toZone = this.zones.get(toZoneId);

    if (fromZone && toZone) {
      fromZone.send({ type: 'PLAYER_LEAVE', playerId });
      // 실제로는 플레이어 상태를 가져와서 toZone에 전달
    }
  }

  // 게임 틱 (서버 메인 루프)
  startGameLoop(): void {
    const tickRate = 50; // 20 ticks per second
    let lastTime = Date.now();

    setInterval(() => {
      const now = Date.now();
      const deltaTime = now - lastTime;
      lastTime = now;

      for (const [_, zone] of this.zones) {
        zone.send({ type: 'TICK', deltaTime });
      }
    }, tickRate);
  }
}

// ============================================
// Demo
// ============================================

async function main() {
  console.log('=== MMORPG Server Demo ===\n');

  const world = new WorldManager();

  // 플레이어 입장
  const townZone = world.getZone('town')!;

  const player1: PlayerState = {
    id: 'player_001',
    name: 'Hero',
    position: { x: 100, y: 100 },
    health: 100,
    maxHealth: 100,
    level: 1,
    exp: 0,
    inventory: []
  };

  townZone.send({ type: 'PLAYER_ENTER', player: player1 });

  // 몬스터 스폰
  const forestZone = world.getZone('forest')!;
  forestZone.send({ type: 'SPAWN_MONSTER', monsterType: 'goblin', position: { x: 50, y: 50 } });
  forestZone.send({ type: 'SPAWN_MONSTER', monsterType: 'wolf', position: { x: 80, y: 30 } });

  // 게임 루프 시작
  world.startGameLoop();

  console.log('\nServer running...');
}

main().catch(console.error);
