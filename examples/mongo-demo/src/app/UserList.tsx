import type { UsersResponse } from '../server';

function UserCard({ user }: { user: UsersResponse[number] }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="avatar">{user.name.charAt(0)}</div>
        <div>
          <h3>{user.name}</h3>
          <p className="email">{user.email}</p>
          <p className="role">Role: {user.role}</p>
        </div>
      </div>
      {user.bio && <p className="card-content">{user.bio}</p>}
      {!user.bio && <p className="no-data">No bio</p>}
    </div>
  );
}

export function UserList({ users }: { users: UsersResponse }) {
  return (
    <div className="user-list">
      <h2>Authors ({users.length})</h2>
      <div className="cards">
        {users.map((user) => (
          <UserCard key={user.id} user={user} />
        ))}
      </div>
    </div>
  );
}
