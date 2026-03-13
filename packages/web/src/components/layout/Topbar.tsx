// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LogOut } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { clearToken, getUser } from '../../api/client';

export function Topbar() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const user = getUser();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/app/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  const handleLogout = () => {
    clearToken();
    navigate('/app/login');
  };

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search contacts, accounts, deals..."
          className="w-80 border-0 bg-transparent focus-visible:ring-0"
        />
      </form>
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-muted-foreground">{user?.name ?? user?.email}</span>
        <Button variant="ghost" size="icon" onClick={handleLogout} title="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
