/**
 * Supervision Pattern - 감독 트리 예제
 *
 * Actor 장애 처리와 복구 전략을 구현합니다.
 */

// ============================================
// 감독 전략 정의
// ============================================

enum Directive {
  Resume = 'RESUME',      // 상태 유지하고 계속
  Restart = 'RESTART',    // 상태 초기화 후 재시작
  Stop = 'STOP',          // 종료
  Escalate = 'ESCALATE',  // 부모에게 전파
}

type Decider = (error: Error) => Directive;

interface SupervisorStrategy {
  type: 'one-for-one' | 'all-for-one';
  maxRetries: number;
  withinMs: number;
  decider: Decider;
}

// ============================================
// 기본 전략 생성 헬퍼
// ============================================

function oneForOneStrategy(
  maxRetries: number,
  withinMs: number,
  decider: Decider
): SupervisorStrategy {
  return { type: 'one-for-one', maxRetries, withinMs, decider };
}

function allForOneStrategy(
  maxRetries: number,
  withinMs: number,
  decider: Decider
): SupervisorStrategy {
  return { type: 'all-for-one', maxRetries, withinMs, decider };
}

// ============================================
// 재시작 통계
// ============================================

class RestartStatistics {
  private failures: number[] = [];

  constructor(
    private maxRetries: number,
    private withinMs: number
  ) {}

  recordFailure(): boolean {
    const now = Date.now();
    this.failures.push(now);

    // 시간 범위 내의 실패만 유지
    this.failures = this.failures.filter(t => now - t < this.withinMs);

    return this.failures.length <= this.maxRetries;
  }

  reset(): void {
    this.failures = [];
  }
}

// ============================================
// Actor 기본 클래스
// ============================================

type ActorRef = SupervisedActor;

abstract class SupervisedActor {
  protected name: string;
  protected children: Map<string, SupervisedActor> = new Map();
  protected parent?: SupervisedActor;
  protected strategy?: SupervisorStrategy;
  protected restartStats: Map<string, RestartStatistics> = new Map();
  protected isRunning = true;

  constructor(name: string, strategy?: SupervisorStrategy) {
    this.name = name;
    this.strategy = strategy;
  }

  // 자식 Actor 생성
  spawn(name: string, actor: SupervisedActor): ActorRef {
    actor.parent = this;
    this.children.set(name, actor);

    if (this.strategy) {
      this.restartStats.set(
        name,
        new RestartStatistics(this.strategy.maxRetries, this.strategy.withinMs)
      );
    }

    console.log(`[${this.name}] Spawned child: ${name}`);
    return actor;
  }

  // 메시지 전송
  send(message: any): void {
    if (!this.isRunning) {
      console.log(`[${this.name}] Actor is stopped, message dropped`);
      return;
    }

    try {
      this.receive(message);
    } catch (error) {
      this.handleFailure(error as Error, message);
    }
  }

  protected abstract receive(message: any): void;

  // 생명주기 훅
  protected preStart(): void {
    console.log(`[${this.name}] Starting...`);
  }

  protected postStop(): void {
    console.log(`[${this.name}] Stopped`);
  }

  protected preRestart(reason: Error): void {
    console.log(`[${this.name}] Restarting due to: ${reason.message}`);
    // 기본: 모든 자식 중지
    this.children.forEach(child => child.stop());
    this.postStop();
  }

  protected postRestart(reason: Error): void {
    this.preStart();
    console.log(`[${this.name}] Restarted`);
  }

  // 장애 처리
  private handleFailure(error: Error, message: any): void {
    console.log(`[${this.name}] Failed with: ${error.message}`);

    if (this.parent) {
      this.parent.supervise(this.name, error, message);
    } else {
      // 루트 Actor는 스스로 처리
      console.log(`[${this.name}] Root actor failure, escalating to system`);
      this.stop();
    }
  }

  // 자식 감독
  private supervise(childName: string, error: Error, message: any): void {
    const child = this.children.get(childName);
    if (!child || !this.strategy) return;

    const directive = this.strategy.decider(error);
    console.log(`[${this.name}] Supervising ${childName}: ${directive}`);

    switch (directive) {
      case Directive.Resume:
        console.log(`[${this.name}] Resuming ${childName}`);
        break;

      case Directive.Restart:
        this.handleRestart(childName, child, error);
        break;

      case Directive.Stop:
        this.handleStop(childName, child);
        break;

      case Directive.Escalate:
        if (this.parent) {
          this.parent.supervise(this.name, error, message);
        }
        break;
    }
  }

  private handleRestart(childName: string, child: SupervisedActor, error: Error): void {
    const stats = this.restartStats.get(childName);

    if (stats && !stats.recordFailure()) {
      console.log(`[${this.name}] Max retries exceeded for ${childName}, stopping`);
      this.handleStop(childName, child);
      return;
    }

    if (this.strategy?.type === 'all-for-one') {
      // 모든 자식 재시작
      console.log(`[${this.name}] All-for-one: restarting all children`);
      this.children.forEach((c, name) => {
        c.preRestart(error);
        c.postRestart(error);
      });
    } else {
      // 해당 자식만 재시작
      child.preRestart(error);
      child.postRestart(error);
    }
  }

  private handleStop(childName: string, child: SupervisedActor): void {
    child.stop();
    this.children.delete(childName);
    this.restartStats.delete(childName);
  }

  stop(): void {
    this.isRunning = false;
    this.children.forEach(child => child.stop());
    this.children.clear();
    this.postStop();
  }
}

// ============================================
// 에러 타입 정의
// ============================================

class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}

class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

class FatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalError';
  }
}

// ============================================
// Actor 구현
// ============================================

// 워커 Actor
class WorkerActor extends SupervisedActor {
  private jobCount = 0;

  constructor(name: string) {
    super(name);
    this.preStart();
  }

  protected receive(message: any): void {
    if (message.type === 'PROCESS_JOB') {
      this.jobCount++;
      console.log(`[${this.name}] Processing job #${this.jobCount}: ${message.data}`);

      // 시뮬레이션: 랜덤하게 에러 발생
      if (message.data === 'transient_error') {
        throw new TransientError('Temporary network issue');
      }
      if (message.data === 'fatal_error') {
        throw new FatalError('Critical system failure');
      }

      console.log(`[${this.name}] Job #${this.jobCount} completed`);
    }
  }

  protected preRestart(reason: Error): void {
    console.log(`[${this.name}] Saving state before restart... (jobs processed: ${this.jobCount})`);
    super.preRestart(reason);
  }

  protected postRestart(reason: Error): void {
    this.jobCount = 0; // 상태 초기화
    super.postRestart(reason);
  }
}

// 데이터베이스 Actor (Resume 전략)
class DatabaseActor extends SupervisedActor {
  private connectionPool = 5;

  constructor(name: string) {
    super(name);
    this.preStart();
  }

  protected receive(message: any): void {
    if (message.type === 'QUERY') {
      console.log(`[${this.name}] Executing query: ${message.sql}`);

      if (message.sql === 'bad_query') {
        throw new DatabaseError('Query syntax error');
      }

      console.log(`[${this.name}] Query completed`);
    }
  }

  // Resume 시 상태 유지
  protected preRestart(reason: Error): void {
    // 데이터베이스 Actor는 커넥션 풀 유지
    console.log(`[${this.name}] Keeping connection pool: ${this.connectionPool}`);
  }
}

// 워커 감독자
class WorkerSupervisor extends SupervisedActor {
  constructor() {
    super('WorkerSupervisor', oneForOneStrategy(3, 60000, (error) => {
      if (error instanceof TransientError) {
        return Directive.Restart;
      }
      if (error instanceof FatalError) {
        return Directive.Stop;
      }
      return Directive.Escalate;
    }));
    this.preStart();
  }

  protected receive(message: any): void {
    if (message.type === 'DISPATCH') {
      // 자식들에게 작업 분배
      const workers = Array.from(this.children.values());
      if (workers.length > 0) {
        const worker = workers[Math.floor(Math.random() * workers.length)];
        worker.send({ type: 'PROCESS_JOB', data: message.data });
      }
    }
  }

  initWorkers(count: number): void {
    for (let i = 1; i <= count; i++) {
      this.spawn(`Worker-${i}`, new WorkerActor(`Worker-${i}`));
    }
  }
}

// 루트 감독자
class RootSupervisor extends SupervisedActor {
  constructor() {
    super('RootSupervisor', oneForOneStrategy(5, 60000, (error) => {
      console.log(`[RootSupervisor] Deciding for error: ${error.name}`);
      if (error instanceof DatabaseError) {
        return Directive.Resume;
      }
      return Directive.Restart;
    }));
    this.preStart();
  }

  protected receive(message: any): void {
    console.log(`[RootSupervisor] Received: ${JSON.stringify(message)}`);
  }
}

// ============================================
// 실행 예제
// ============================================

async function main() {
  console.log('=== Supervision Pattern Demo ===\n');

  // 감독 트리 구성
  const root = new RootSupervisor();
  const workerSupervisor = root.spawn('WorkerSupervisor', new WorkerSupervisor()) as WorkerSupervisor;
  const database = root.spawn('Database', new DatabaseActor('Database'));

  // 워커 초기화
  workerSupervisor.initWorkers(3);

  console.log('\n--- 1. Normal Operation ---\n');

  workerSupervisor.send({ type: 'DISPATCH', data: 'job-1' });
  workerSupervisor.send({ type: 'DISPATCH', data: 'job-2' });
  database.send({ type: 'QUERY', sql: 'SELECT * FROM users' });

  await delay(100);

  console.log('\n--- 2. Transient Error (Restart) ---\n');

  workerSupervisor.send({ type: 'DISPATCH', data: 'transient_error' });

  await delay(100);

  console.log('\n--- 3. Database Error (Resume) ---\n');

  database.send({ type: 'QUERY', sql: 'bad_query' });

  await delay(100);

  console.log('\n--- 4. Normal Operation After Recovery ---\n');

  workerSupervisor.send({ type: 'DISPATCH', data: 'job-3' });
  database.send({ type: 'QUERY', sql: 'SELECT * FROM orders' });

  await delay(100);

  console.log('\n--- 5. Fatal Error (Stop) ---\n');

  workerSupervisor.send({ type: 'DISPATCH', data: 'fatal_error' });

  await delay(100);

  console.log('\n--- 6. System Shutdown ---\n');

  root.stop();

  console.log('\n=== Demo Complete ===');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
