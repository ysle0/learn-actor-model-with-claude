/**
 * Chat Server Actor Pattern - 실시간 채팅 서버 예제
 *
 * 채팅 서버의 Actor 기반 구현을 보여줍니다.
 */

// ============================================
// 타입 정의
// ============================================

type UserStatus = 'online' | 'away' | 'offline';

interface UserInfo {
  userId: string;
  username: string;
  status: UserStatus;
  joinedAt: Date;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: Date;
  type: 'public' | 'private' | 'system';
}

// ============================================
// 메시지 타입
// ============================================

type ChatRoomMessage =
  | { type: 'JOIN_ROOM'; userId: string; username: string }
  | { type: 'LEAVE_ROOM'; userId: string }
  | { type: 'SEND_MESSAGE'; userId: string; content: string }
  | { type: 'DIRECT_MESSAGE'; fromUserId: string; toUserId: string; content: string }
  | { type: 'SET_STATUS'; userId: string; status: UserStatus }
  | { type: 'GET_HISTORY'; count: number }
  | { type: 'GET_USERS' };

type UserSessionMessage =
  | { type: 'MESSAGE_RECEIVED'; message: ChatMessage }
  | { type: 'USER_JOINED'; user: UserInfo }
  | { type: 'USER_LEFT'; userId: string; username: string }
  | { type: 'USER_STATUS_CHANGED'; userId: string; status: UserStatus }
  | { type: 'ROOM_HISTORY'; messages: ChatMessage[] }
  | { type: 'ROOM_USERS'; users: UserInfo[] };

// ============================================
// Actor 기본 인프라
// ============================================

type ActorRef<T> = {
  send: (msg: T) => void;
  ask: <R>(msg: T) => Promise<R>;
  id: string;
};

class ActorSystem {
  private actors = new Map<string, any>();

  createActor<T, S>(
    id: string,
    initialState: S,
    behavior: (state: S, msg: T, ctx: ActorContext) => S | Promise<S>
  ): ActorRef<T> {
    const actor = new StatefulActor(id, initialState, behavior, this);
    this.actors.set(id, actor);
    return actor.ref();
  }

  getActor<T>(id: string): ActorRef<T> | undefined {
    return this.actors.get(id)?.ref();
  }

  removeActor(id: string): void {
    this.actors.delete(id);
  }
}

interface ActorContext {
  system: ActorSystem;
}

class StatefulActor<T, S> {
  private state: S;
  private mailbox: Array<{ msg: T; resolve?: (value: any) => void }> = [];
  private processing = false;
  private context: ActorContext;

  constructor(
    private id: string,
    initialState: S,
    private behavior: (state: S, msg: T, ctx: ActorContext) => S | Promise<S>,
    private system: ActorSystem
  ) {
    this.state = initialState;
    this.context = { system };
  }

  ref(): ActorRef<T> {
    return {
      id: this.id,
      send: (msg: T) => {
        this.mailbox.push({ msg });
        this.processNext();
      },
      ask: <R>(msg: T): Promise<R> => {
        return new Promise(resolve => {
          this.mailbox.push({ msg, resolve });
          this.processNext();
        });
      },
    };
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.mailbox.length > 0) {
      const { msg, resolve } = this.mailbox.shift()!;
      try {
        const result = await this.behavior(this.state, msg, this.context);
        if (result !== undefined) {
          this.state = result;
        }
        if (resolve) {
          resolve(this.state);
        }
      } catch (error) {
        console.error(`[${this.id}] Error:`, error);
      }
    }

    this.processing = false;
  }
}

// ============================================
// ChatRoom Actor
// ============================================

interface ChatRoomState {
  roomId: string;
  name: string;
  users: Map<string, UserInfo>;
  userSessions: Map<string, ActorRef<UserSessionMessage>>;
  messageHistory: ChatMessage[];
  maxHistorySize: number;
}

function createChatRoomActor(
  system: ActorSystem,
  roomId: string,
  name: string
): ActorRef<ChatRoomMessage> {
  const initialState: ChatRoomState = {
    roomId,
    name,
    users: new Map(),
    userSessions: new Map(),
    messageHistory: [],
    maxHistorySize: 100,
  };

  return system.createActor<ChatRoomMessage, ChatRoomState>(
    `room-${roomId}`,
    initialState,
    (state, msg, ctx) => {
      switch (msg.type) {
        case 'JOIN_ROOM': {
          if (state.users.has(msg.userId)) {
            console.log(`[Room ${name}] ${msg.username} is already in the room`);
            return state;
          }

          const user: UserInfo = {
            userId: msg.userId,
            username: msg.username,
            status: 'online',
            joinedAt: new Date(),
          };

          state.users.set(msg.userId, user);

          // 사용자 세션 Actor 생성
          const sessionActor = createUserSessionActor(system, msg.userId, msg.username);
          state.userSessions.set(msg.userId, sessionActor);

          console.log(`[Room ${name}] ${msg.username} joined (${state.users.size} users)`);

          // 시스템 메시지 추가
          const systemMsg = createSystemMessage(`${msg.username} joined the room`);
          addToHistory(state, systemMsg);

          // 다른 사용자들에게 알림
          broadcastToOthers(state, msg.userId, { type: 'USER_JOINED', user });

          // 새 사용자에게 이력 전송
          sessionActor.send({
            type: 'ROOM_HISTORY',
            messages: state.messageHistory.slice(-20),
          });

          return state;
        }

        case 'LEAVE_ROOM': {
          const user = state.users.get(msg.userId);
          if (!user) return state;

          state.users.delete(msg.userId);
          state.userSessions.delete(msg.userId);

          console.log(`[Room ${name}] ${user.username} left (${state.users.size} users)`);

          // 시스템 메시지
          const systemMsg = createSystemMessage(`${user.username} left the room`);
          addToHistory(state, systemMsg);

          // 다른 사용자들에게 알림
          broadcastToAll(state, {
            type: 'USER_LEFT',
            userId: msg.userId,
            username: user.username,
          });

          return state;
        }

        case 'SEND_MESSAGE': {
          const user = state.users.get(msg.userId);
          if (!user) return state;

          const chatMsg: ChatMessage = {
            id: generateId(),
            senderId: msg.userId,
            senderName: user.username,
            content: msg.content,
            timestamp: new Date(),
            type: 'public',
          };

          addToHistory(state, chatMsg);
          console.log(`[Room ${name}] ${user.username}: ${msg.content}`);

          // 모든 사용자에게 브로드캐스트
          broadcastToAll(state, { type: 'MESSAGE_RECEIVED', message: chatMsg });

          return state;
        }

        case 'DIRECT_MESSAGE': {
          const fromUser = state.users.get(msg.fromUserId);
          const toSession = state.userSessions.get(msg.toUserId);
          const toUser = state.users.get(msg.toUserId);

          if (!fromUser || !toSession || !toUser) {
            console.log(`[Room ${name}] DM failed: user not found`);
            return state;
          }

          const dmMsg: ChatMessage = {
            id: generateId(),
            senderId: msg.fromUserId,
            senderName: fromUser.username,
            content: msg.content,
            timestamp: new Date(),
            type: 'private',
          };

          console.log(`[Room ${name}] DM from ${fromUser.username} to ${toUser.username}: ${msg.content}`);

          // 수신자에게만 전송
          toSession.send({ type: 'MESSAGE_RECEIVED', message: dmMsg });

          // 발신자에게도 확인용으로 전송
          const fromSession = state.userSessions.get(msg.fromUserId);
          if (fromSession) {
            fromSession.send({ type: 'MESSAGE_RECEIVED', message: dmMsg });
          }

          return state;
        }

        case 'SET_STATUS': {
          const user = state.users.get(msg.userId);
          if (!user) return state;

          user.status = msg.status;
          console.log(`[Room ${name}] ${user.username} is now ${msg.status}`);

          broadcastToOthers(state, msg.userId, {
            type: 'USER_STATUS_CHANGED',
            userId: msg.userId,
            status: msg.status,
          });

          return state;
        }

        case 'GET_HISTORY': {
          return state;
        }

        case 'GET_USERS': {
          return state;
        }

        default:
          return state;
      }
    }
  );
}

function createSystemMessage(content: string): ChatMessage {
  return {
    id: generateId(),
    senderId: 'system',
    senderName: 'System',
    content,
    timestamp: new Date(),
    type: 'system',
  };
}

function addToHistory(state: ChatRoomState, msg: ChatMessage): void {
  state.messageHistory.push(msg);
  if (state.messageHistory.length > state.maxHistorySize) {
    state.messageHistory.shift();
  }
}

function broadcastToAll(state: ChatRoomState, msg: UserSessionMessage): void {
  state.userSessions.forEach(session => session.send(msg));
}

function broadcastToOthers(state: ChatRoomState, excludeId: string, msg: UserSessionMessage): void {
  state.userSessions.forEach((session, id) => {
    if (id !== excludeId) {
      session.send(msg);
    }
  });
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================
// UserSession Actor
// ============================================

interface UserSessionState {
  sessionId: string;
  username: string;
  receivedMessages: ChatMessage[];
}

function createUserSessionActor(
  system: ActorSystem,
  userId: string,
  username: string
): ActorRef<UserSessionMessage> {
  const initialState: UserSessionState = {
    sessionId: userId,
    username,
    receivedMessages: [],
  };

  return system.createActor<UserSessionMessage, UserSessionState>(
    `session-${userId}`,
    initialState,
    (state, msg, ctx) => {
      switch (msg.type) {
        case 'MESSAGE_RECEIVED': {
          state.receivedMessages.push(msg.message);
          const prefix = msg.message.type === 'private' ? '[DM] ' : '';
          console.log(
            `  [${username}] ${prefix}${msg.message.senderName}: ${msg.message.content}`
          );
          return state;
        }

        case 'USER_JOINED': {
          console.log(`  [${username}] ${msg.user.username} joined`);
          return state;
        }

        case 'USER_LEFT': {
          console.log(`  [${username}] ${msg.username} left`);
          return state;
        }

        case 'USER_STATUS_CHANGED': {
          console.log(`  [${username}] User ${msg.userId} is now ${msg.status}`);
          return state;
        }

        case 'ROOM_HISTORY': {
          console.log(`  [${username}] Received ${msg.messages.length} messages from history`);
          return state;
        }

        case 'ROOM_USERS': {
          console.log(`  [${username}] Room has ${msg.users.length} users`);
          return state;
        }

        default:
          return state;
      }
    }
  );
}

// ============================================
// 실행 예제
// ============================================

async function main() {
  console.log('=== Chat Server Actor Pattern Demo ===\n');

  const system = new ActorSystem();

  // 채팅방 생성
  const generalRoom = createChatRoomActor(system, 'general', 'General');

  console.log('--- 1. Users Joining ---\n');

  generalRoom.send({ type: 'JOIN_ROOM', userId: 'alice', username: 'Alice' });
  await delay(100);

  generalRoom.send({ type: 'JOIN_ROOM', userId: 'bob', username: 'Bob' });
  await delay(100);

  generalRoom.send({ type: 'JOIN_ROOM', userId: 'charlie', username: 'Charlie' });
  await delay(100);

  console.log('\n--- 2. Public Messages ---\n');

  generalRoom.send({ type: 'SEND_MESSAGE', userId: 'alice', content: 'Hello everyone!' });
  await delay(100);

  generalRoom.send({ type: 'SEND_MESSAGE', userId: 'bob', content: 'Hi Alice!' });
  await delay(100);

  generalRoom.send({ type: 'SEND_MESSAGE', userId: 'charlie', content: 'Hey all!' });
  await delay(100);

  console.log('\n--- 3. Direct Messages ---\n');

  generalRoom.send({
    type: 'DIRECT_MESSAGE',
    fromUserId: 'alice',
    toUserId: 'bob',
    content: 'Hey Bob, can we talk privately?',
  });
  await delay(100);

  generalRoom.send({
    type: 'DIRECT_MESSAGE',
    fromUserId: 'bob',
    toUserId: 'alice',
    content: 'Sure, what is it?',
  });
  await delay(100);

  console.log('\n--- 4. Status Changes ---\n');

  generalRoom.send({ type: 'SET_STATUS', userId: 'charlie', status: 'away' });
  await delay(100);

  console.log('\n--- 5. More Messages ---\n');

  generalRoom.send({ type: 'SEND_MESSAGE', userId: 'alice', content: 'Is Charlie still here?' });
  await delay(100);

  generalRoom.send({ type: 'SET_STATUS', userId: 'charlie', status: 'online' });
  await delay(100);

  generalRoom.send({ type: 'SEND_MESSAGE', userId: 'charlie', content: "I'm back!" });
  await delay(100);

  console.log('\n--- 6. User Leaving ---\n');

  generalRoom.send({ type: 'LEAVE_ROOM', userId: 'bob' });
  await delay(100);

  generalRoom.send({ type: 'SEND_MESSAGE', userId: 'alice', content: 'Bye Bob!' });
  await delay(100);

  console.log('\n=== Demo Complete ===');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
