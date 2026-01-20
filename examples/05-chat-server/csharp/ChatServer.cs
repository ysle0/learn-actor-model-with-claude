// Chat Server Actor Pattern - 실시간 채팅 서버 예제 in C#
// Orleans 스타일로 구현

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace ChatServerExample
{
    // ============================================
    // 타입 정의
    // ============================================

    public enum UserStatus { Online, Away, Offline }

    public record UserInfo(string UserId, string Username, UserStatus Status, DateTime JoinedAt);

    public record ChatMessage(
        string Id,
        string SenderId,
        string SenderName,
        string Content,
        DateTime Timestamp,
        string Type  // "public", "private", "system"
    );

    // ============================================
    // User Session Actor
    // ============================================

    public class UserSessionActor
    {
        private readonly string _sessionId;
        private readonly string _username;
        private readonly List<ChatMessage> _messages = new();

        public UserSessionActor(string userId, string username)
        {
            _sessionId = userId;
            _username = username;
        }

        public void Receive(object msg)
        {
            switch (msg)
            {
                case MessageReceived m:
                    _messages.Add(m.Message);
                    var prefix = m.Message.Type == "private" ? "[DM] " : "";
                    Console.WriteLine($"  [{_username}] {prefix}{m.Message.SenderName}: {m.Message.Content}");
                    break;

                case UserJoinedMsg m:
                    Console.WriteLine($"  [{_username}] {m.User.Username} joined");
                    break;

                case UserLeftMsg m:
                    Console.WriteLine($"  [{_username}] {m.Username} left");
                    break;

                case UserStatusChangedMsg m:
                    Console.WriteLine($"  [{_username}] User {m.UserId} is now {m.Status}");
                    break;

                case RoomHistoryMsg m:
                    Console.WriteLine($"  [{_username}] Received {m.Messages.Count} messages from history");
                    break;
            }
        }
    }

    // ============================================
    // 메시지 타입
    // ============================================

    public record JoinRoom(string UserId, string Username);
    public record LeaveRoom(string UserId);
    public record SendMessage(string UserId, string Content);
    public record DirectMessage(string FromUserId, string ToUserId, string Content);
    public record SetStatus(string UserId, UserStatus Status);

    public record MessageReceived(ChatMessage Message);
    public record UserJoinedMsg(UserInfo User);
    public record UserLeftMsg(string UserId, string Username);
    public record UserStatusChangedMsg(string UserId, UserStatus Status);
    public record RoomHistoryMsg(List<ChatMessage> Messages);

    // ============================================
    // ChatRoom Actor
    // ============================================

    public class ChatRoomActor
    {
        private readonly string _roomId;
        private readonly string _name;
        private readonly Dictionary<string, UserInfo> _users = new();
        private readonly Dictionary<string, UserSessionActor> _userSessions = new();
        private readonly List<ChatMessage> _messageHistory = new();
        private readonly int _maxHistorySize = 100;
        private long _msgCounter = 0;

        public ChatRoomActor(string roomId, string name)
        {
            _roomId = roomId;
            _name = name;
        }

        public void Receive(object msg)
        {
            switch (msg)
            {
                case JoinRoom m:
                    HandleJoinRoom(m);
                    break;
                case LeaveRoom m:
                    HandleLeaveRoom(m);
                    break;
                case SendMessage m:
                    HandleSendMessage(m);
                    break;
                case DirectMessage m:
                    HandleDirectMessage(m);
                    break;
                case SetStatus m:
                    HandleSetStatus(m);
                    break;
            }
        }

        private void HandleJoinRoom(JoinRoom m)
        {
            if (_users.ContainsKey(m.UserId))
            {
                Console.WriteLine($"[Room {_name}] {m.Username} is already in the room");
                return;
            }

            var user = new UserInfo(m.UserId, m.Username, UserStatus.Online, DateTime.UtcNow);
            _users[m.UserId] = user;

            var session = new UserSessionActor(m.UserId, m.Username);
            _userSessions[m.UserId] = session;

            Console.WriteLine($"[Room {_name}] {m.Username} joined ({_users.Count} users)");

            // 시스템 메시지
            var sysMsg = CreateSystemMessage($"{m.Username} joined the room");
            AddToHistory(sysMsg);

            // 다른 사용자들에게 알림
            BroadcastToOthers(m.UserId, new UserJoinedMsg(user));

            // 새 사용자에게 이력 전송
            var history = _messageHistory.TakeLast(20).ToList();
            session.Receive(new RoomHistoryMsg(history));
        }

        private void HandleLeaveRoom(LeaveRoom m)
        {
            if (!_users.TryGetValue(m.UserId, out var user))
                return;

            _users.Remove(m.UserId);
            _userSessions.Remove(m.UserId);

            Console.WriteLine($"[Room {_name}] {user.Username} left ({_users.Count} users)");

            var sysMsg = CreateSystemMessage($"{user.Username} left the room");
            AddToHistory(sysMsg);

            BroadcastToAll(new UserLeftMsg(m.UserId, user.Username));
        }

        private void HandleSendMessage(SendMessage m)
        {
            if (!_users.TryGetValue(m.UserId, out var user))
                return;

            var chatMsg = new ChatMessage(
                GenerateId(),
                m.UserId,
                user.Username,
                m.Content,
                DateTime.UtcNow,
                "public"
            );

            AddToHistory(chatMsg);
            Console.WriteLine($"[Room {_name}] {user.Username}: {m.Content}");

            BroadcastToAll(new MessageReceived(chatMsg));
        }

        private void HandleDirectMessage(DirectMessage m)
        {
            if (!_users.TryGetValue(m.FromUserId, out var fromUser))
                return;
            if (!_userSessions.TryGetValue(m.ToUserId, out var toSession))
                return;
            if (!_users.TryGetValue(m.ToUserId, out var toUser))
                return;

            var dmMsg = new ChatMessage(
                GenerateId(),
                m.FromUserId,
                fromUser.Username,
                m.Content,
                DateTime.UtcNow,
                "private"
            );

            Console.WriteLine($"[Room {_name}] DM from {fromUser.Username} to {toUser.Username}: {m.Content}");

            // 수신자에게 전송
            toSession.Receive(new MessageReceived(dmMsg));

            // 발신자에게도 전송
            if (_userSessions.TryGetValue(m.FromUserId, out var fromSession))
            {
                fromSession.Receive(new MessageReceived(dmMsg));
            }
        }

        private void HandleSetStatus(SetStatus m)
        {
            if (!_users.TryGetValue(m.UserId, out var user))
                return;

            _users[m.UserId] = user with { Status = m.Status };
            Console.WriteLine($"[Room {_name}] {user.Username} is now {m.Status}");

            BroadcastToOthers(m.UserId, new UserStatusChangedMsg(m.UserId, m.Status));
        }

        private ChatMessage CreateSystemMessage(string content)
        {
            return new ChatMessage(
                GenerateId(),
                "system",
                "System",
                content,
                DateTime.UtcNow,
                "system"
            );
        }

        private void AddToHistory(ChatMessage msg)
        {
            _messageHistory.Add(msg);
            if (_messageHistory.Count > _maxHistorySize)
            {
                _messageHistory.RemoveAt(0);
            }
        }

        private void BroadcastToAll(object msg)
        {
            foreach (var session in _userSessions.Values)
            {
                session.Receive(msg);
            }
        }

        private void BroadcastToOthers(string excludeId, object msg)
        {
            foreach (var (id, session) in _userSessions)
            {
                if (id != excludeId)
                {
                    session.Receive(msg);
                }
            }
        }

        private string GenerateId()
        {
            _msgCounter++;
            return $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{_msgCounter}";
        }
    }

    // ============================================
    // 메인 프로그램
    // ============================================

    public class Program
    {
        public static async Task Main()
        {
            Console.WriteLine("=== Chat Server Actor Pattern Demo (C#) ===\n");

            var generalRoom = new ChatRoomActor("general", "General");

            Console.WriteLine("--- 1. Users Joining ---\n");

            generalRoom.Receive(new JoinRoom("alice", "Alice"));
            await Task.Delay(100);

            generalRoom.Receive(new JoinRoom("bob", "Bob"));
            await Task.Delay(100);

            generalRoom.Receive(new JoinRoom("charlie", "Charlie"));
            await Task.Delay(100);

            Console.WriteLine("\n--- 2. Public Messages ---\n");

            generalRoom.Receive(new SendMessage("alice", "Hello everyone!"));
            await Task.Delay(100);

            generalRoom.Receive(new SendMessage("bob", "Hi Alice!"));
            await Task.Delay(100);

            generalRoom.Receive(new SendMessage("charlie", "Hey all!"));
            await Task.Delay(100);

            Console.WriteLine("\n--- 3. Direct Messages ---\n");

            generalRoom.Receive(new DirectMessage("alice", "bob", "Hey Bob, can we talk privately?"));
            await Task.Delay(100);

            generalRoom.Receive(new DirectMessage("bob", "alice", "Sure, what is it?"));
            await Task.Delay(100);

            Console.WriteLine("\n--- 4. Status Changes ---\n");

            generalRoom.Receive(new SetStatus("charlie", UserStatus.Away));
            await Task.Delay(100);

            Console.WriteLine("\n--- 5. More Messages ---\n");

            generalRoom.Receive(new SendMessage("alice", "Is Charlie still here?"));
            await Task.Delay(100);

            generalRoom.Receive(new SetStatus("charlie", UserStatus.Online));
            await Task.Delay(100);

            generalRoom.Receive(new SendMessage("charlie", "I'm back!"));
            await Task.Delay(100);

            Console.WriteLine("\n--- 6. User Leaving ---\n");

            generalRoom.Receive(new LeaveRoom("bob"));
            await Task.Delay(100);

            generalRoom.Receive(new SendMessage("alice", "Bye Bob!"));
            await Task.Delay(100);

            Console.WriteLine("\n=== Demo Complete ===");
        }
    }
}
