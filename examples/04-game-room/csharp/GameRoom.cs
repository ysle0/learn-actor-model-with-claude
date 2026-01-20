// Game Room Actor Pattern - 멀티플레이어 게임 룸 예제 in C#
// Orleans 스타일로 구현

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace GameRoomExample
{
    // ============================================
    // 타입 정의
    // ============================================

    public enum RoomStatus
    {
        Waiting,
        Starting,
        Playing,
        Finished
    }

    public record PlayerInfo(string PlayerId, string Name, bool IsReady, int Score);

    public record RoomState(
        string RoomId,
        RoomStatus Status,
        Dictionary<string, PlayerInfo> Players,
        int MaxPlayers,
        int MinPlayers
    );

    // ============================================
    // 메시지 타입
    // ============================================

    public interface IRoomMessage { }
    public record JoinRoom(string PlayerId, string PlayerName) : IRoomMessage;
    public record LeaveRoom(string PlayerId) : IRoomMessage;
    public record SetReady(string PlayerId, bool Ready) : IRoomMessage;
    public record GameAction(string PlayerId, string ActionType, int Points) : IRoomMessage;
    public record StartGame() : IRoomMessage;
    public record EndGame(string? WinnerId) : IRoomMessage;
    public record GetState() : IRoomMessage;

    public interface IPlayerMessage { }
    public record PlayerJoined(PlayerInfo Player) : IPlayerMessage;
    public record PlayerLeft(string PlayerId) : IPlayerMessage;
    public record PlayerReadyChanged(string PlayerId, bool Ready) : IPlayerMessage;
    public record GameStarting(int Countdown) : IPlayerMessage;
    public record GameStarted() : IPlayerMessage;
    public record GameActionBroadcast(string PlayerId, string ActionType, int Points) : IPlayerMessage;
    public record GameEnded(string? WinnerId, Dictionary<string, int> Scores) : IPlayerMessage;

    // ============================================
    // Room Grain (Actor)
    // ============================================

    public interface IRoomGrain
    {
        Task<bool> JoinRoom(string playerId, string playerName);
        Task LeaveRoom(string playerId);
        Task SetReady(string playerId, bool ready);
        Task GameAction(string playerId, string actionType, int points);
        Task StartGame();
        Task EndGame(string? winnerId);
        Task<RoomState> GetState();
    }

    public class RoomGrain : IRoomGrain
    {
        private readonly string _roomId;
        private RoomStatus _status = RoomStatus.Waiting;
        private readonly Dictionary<string, PlayerInfo> _players = new();
        private readonly Dictionary<string, PlayerGrain> _playerActors = new();
        private readonly int _maxPlayers = 4;
        private readonly int _minPlayers = 2;

        public RoomGrain(string roomId)
        {
            _roomId = roomId;
        }

        public async Task<bool> JoinRoom(string playerId, string playerName)
        {
            if (_players.Count >= _maxPlayers)
            {
                Console.WriteLine($"[Room {_roomId}] Room is full, rejecting {playerName}");
                return false;
            }

            if (_status != RoomStatus.Waiting)
            {
                Console.WriteLine($"[Room {_roomId}] Game in progress, rejecting {playerName}");
                return false;
            }

            var player = new PlayerInfo(playerId, playerName, false, 0);
            _players[playerId] = player;

            var playerActor = new PlayerGrain(playerId, playerName);
            _playerActors[playerId] = playerActor;

            Console.WriteLine($"[Room {_roomId}] {playerName} joined ({_players.Count}/{_maxPlayers})");

            // 다른 플레이어들에게 알림
            await Broadcast(playerId, new PlayerJoined(player));

            return true;
        }

        public async Task LeaveRoom(string playerId)
        {
            if (!_players.TryGetValue(playerId, out var player))
                return;

            _players.Remove(playerId);
            _playerActors.Remove(playerId);

            Console.WriteLine($"[Room {_roomId}] {player.Name} left ({_players.Count}/{_maxPlayers})");

            await Broadcast(null, new PlayerLeft(playerId));

            if (_status == RoomStatus.Playing && _players.Count < _minPlayers)
            {
                _status = RoomStatus.Finished;
                Console.WriteLine($"[Room {_roomId}] Not enough players, game ended");
                await Broadcast(null, new GameEnded(null, GetScores()));
            }

            if (_players.Count == 0)
            {
                _status = RoomStatus.Waiting;
                Console.WriteLine($"[Room {_roomId}] Room is empty, resetting");
            }
        }

        public async Task SetReady(string playerId, bool ready)
        {
            if (!_players.TryGetValue(playerId, out var player) || _status != RoomStatus.Waiting)
                return;

            _players[playerId] = player with { IsReady = ready };
            Console.WriteLine($"[Room {_roomId}] {player.Name} is {(ready ? "ready" : "not ready")}");

            await Broadcast(null, new PlayerReadyChanged(playerId, ready));
            await CheckStartCondition();
        }

        public async Task GameAction(string playerId, string actionType, int points)
        {
            if (_status != RoomStatus.Playing)
                return;

            if (!_players.TryGetValue(playerId, out var player))
                return;

            Console.WriteLine($"[Room {_roomId}] {player.Name} action: {actionType}");

            if (actionType == "SCORE")
            {
                _players[playerId] = player with { Score = player.Score + points };
                Console.WriteLine($"[Room {_roomId}] {player.Name} score: {_players[playerId].Score}");
            }

            await Broadcast(null, new GameActionBroadcast(playerId, actionType, points));
        }

        public async Task StartGame()
        {
            if (_status != RoomStatus.Waiting)
                return;

            _status = RoomStatus.Starting;
            Console.WriteLine($"[Room {_roomId}] Game starting...");

            for (int countdown = 3; countdown > 0; countdown--)
            {
                await Broadcast(null, new GameStarting(countdown));
                Console.WriteLine($"[Room {_roomId}] Starting in {countdown}...");
                await Task.Delay(1000);
            }

            _status = RoomStatus.Playing;
            Console.WriteLine($"[Room {_roomId}] Game started!");
            await Broadcast(null, new GameStarted());
        }

        public async Task EndGame(string? winnerId)
        {
            if (_status != RoomStatus.Playing)
                return;

            _status = RoomStatus.Finished;
            Console.WriteLine($"[Room {_roomId}] Game ended! Winner: {winnerId ?? "none"}");

            await Broadcast(null, new GameEnded(winnerId, GetScores()));

            // 5초 후 리셋
            _ = Task.Run(async () =>
            {
                await Task.Delay(5000);
                _status = RoomStatus.Waiting;
                foreach (var pid in _players.Keys.ToList())
                {
                    _players[pid] = _players[pid] with { IsReady = false, Score = 0 };
                }
                Console.WriteLine($"[Room {_roomId}] Room reset to waiting");
            });
        }

        public Task<RoomState> GetState()
        {
            return Task.FromResult(new RoomState(
                _roomId,
                _status,
                new Dictionary<string, PlayerInfo>(_players),
                _maxPlayers,
                _minPlayers
            ));
        }

        private async Task Broadcast(string? excludeId, IPlayerMessage message)
        {
            foreach (var (id, actor) in _playerActors)
            {
                if (id != excludeId)
                {
                    await actor.Receive(message);
                }
            }
        }

        private async Task CheckStartCondition()
        {
            if (_players.Count >= _minPlayers && _players.Values.All(p => p.IsReady))
            {
                Console.WriteLine($"[Room {_roomId}] All players ready!");
                await StartGame();
            }
        }

        private Dictionary<string, int> GetScores()
        {
            return _players.ToDictionary(p => p.Key, p => p.Value.Score);
        }
    }

    // ============================================
    // Player Grain (Actor)
    // ============================================

    public class PlayerGrain
    {
        private readonly string _playerId;
        private readonly string _name;

        public PlayerGrain(string playerId, string name)
        {
            _playerId = playerId;
            _name = name;
        }

        public Task Receive(IPlayerMessage message)
        {
            switch (message)
            {
                case PlayerJoined m:
                    Console.WriteLine($"[Player {_name}] {m.Player.Name} joined the room");
                    break;
                case PlayerLeft m:
                    Console.WriteLine($"[Player {_name}] Player {m.PlayerId} left");
                    break;
                case PlayerReadyChanged m:
                    Console.WriteLine($"[Player {_name}] Player {m.PlayerId} is {(m.Ready ? "ready" : "not ready")}");
                    break;
                case GameStarting m:
                    Console.WriteLine($"[Player {_name}] Game starting in {m.Countdown}...");
                    break;
                case GameStarted:
                    Console.WriteLine($"[Player {_name}] Game started!");
                    break;
                case GameActionBroadcast m:
                    Console.WriteLine($"[Player {_name}] Received action from {m.PlayerId}");
                    break;
                case GameEnded m:
                    Console.WriteLine($"[Player {_name}] Game ended! Winner: {m.WinnerId ?? "none"}");
                    break;
            }
            return Task.CompletedTask;
        }
    }

    // ============================================
    // 메인 프로그램
    // ============================================

    public class Program
    {
        public static async Task Main()
        {
            Console.WriteLine("=== Game Room Actor Pattern Demo (C#) ===\n");

            var room = new RoomGrain("001");

            Console.WriteLine("--- 1. Players Joining ---\n");

            await room.JoinRoom("p1", "Alice");
            await Task.Delay(100);

            await room.JoinRoom("p2", "Bob");
            await Task.Delay(100);

            await room.JoinRoom("p3", "Charlie");
            await Task.Delay(100);

            Console.WriteLine("\n--- 2. Players Getting Ready ---\n");

            await room.SetReady("p1", true);
            await Task.Delay(100);

            await room.SetReady("p2", true);
            await Task.Delay(100);

            // 마지막 플레이어가 준비되면 게임 시작
            await room.SetReady("p3", true);

            // 게임 시작 대기
            await Task.Delay(1000);

            Console.WriteLine("\n--- 3. Game Actions ---\n");

            await room.GameAction("p1", "SCORE", 10);
            await Task.Delay(100);

            await room.GameAction("p2", "SCORE", 15);
            await Task.Delay(100);

            await room.GameAction("p1", "SCORE", 20);
            await Task.Delay(100);

            Console.WriteLine("\n--- 4. Game End ---\n");

            await room.EndGame("p1");
            await Task.Delay(1000);

            Console.WriteLine("\n--- 5. Player Leaving ---\n");

            await room.LeaveRoom("p3");
            await Task.Delay(100);

            Console.WriteLine("\n=== Demo Complete ===");
        }
    }
}
