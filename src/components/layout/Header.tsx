import React from 'react';
import { Menu, Search, Moon, Sun, Plus, LogOut } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import NotificationPopover from './NotificationPopover';
import Avatar from '../ui/Avatar';
import Button from '../ui/Button';

interface HeaderProps {
  title: string;
  onOpenMobileMenu: () => void;
  onOpenCommandPalette: () => void;
  onOpenNewDayOffModal: () => void;
  onNavigateToPlanner: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  onOpenMobileMenu,
  onOpenCommandPalette,
  onOpenNewDayOffModal,
  onNavigateToPlanner,
}) => {
  const { theme, toggleTheme } = useTheme();
  const { user, isAdmin, isManager, isViewer, departmentScopeText, logout } = useAuth();

  const roleLabel = isAdmin ? 'Administrador' : isManager ? 'Gestor' : 'Leitor';

  return (
    <header className="sticky top-0 z-30 h-16 bg-white/75 dark:bg-zinc-900/75 mac-blur border-b border-black/[0.06] dark:border-white/[0.08] px-4 sm:px-6 flex items-center justify-between transition-colors">
      <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-3">
        {/* Botão para abrir menu no mobile */}
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden shrink-0 min-h-11 min-w-11 p-2 rounded-xl text-zinc-600 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5"
          aria-label="Abrir Menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Título da Página */}
        <div className="min-w-0">
          <h2 title={title} className="truncate text-sm sm:text-lg font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight">
            {title}
          </h2>
          <p title={user?.company?.name} className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{user?.company?.name} · {user?.company?.code}</p>
        </div>
      </div>

      {/* Centro / Direita: Busca, Ações, Notificações, Tema, Perfil e Logout */}
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-3">
        {/* Barra de Busca rápida com atalho Ctrl+K */}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Buscar funcionário ou comando"
          className="flex min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 justify-center items-center gap-2 px-2 sm:px-3 py-1.5 rounded-xl bg-zinc-100/80 dark:bg-zinc-800/80 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 border border-black/[0.04] dark:border-white/[0.06] text-xs text-zinc-500 dark:text-zinc-400 transition-all duration-150 focus:outline-none"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">Buscar funcionário ou comando...</span>
          <span className="hidden sm:inline xl:hidden">Buscar...</span>
          <kbd className="hidden xl:inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded shadow-xs">
            Ctrl K
          </kbd>
        </button>

        {/* Botão de Ação Rápida: Nova Folga (apenas para quem tem permissão de escrita) */}
        {!isViewer && (
          <Button
            variant="primary"
            size="sm"
            onClick={onOpenNewDayOffModal}
            icon={<Plus className="w-3.5 h-3.5" />}
            className="hidden sm:inline-flex"
          >
            Nova Folga
          </Button>
        )}

        {/* Central de Notificações */}
        <NotificationPopover onNavigateToPlanner={onNavigateToPlanner} />

        {/* Alternância de Tema Claro / Escuro */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Alternar para tema ${theme === 'dark' ? 'claro' : 'escuro'}`}
          className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 flex items-center justify-center p-2 rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus:outline-none"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-zinc-600" />
          )}
        </button>

        {/* Perfil do Usuário com Indicador de Escopo */}
        <div className="flex items-center gap-2 pl-1 sm:pl-2 border-l border-black/[0.06] dark:border-white/[0.08]">
          <div className="hidden sm:block"><Avatar name={user?.name || 'Usuário'} size="sm" /></div>
          <div className="hidden xl:block text-left max-w-[180px]">
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 leading-tight truncate">
              {user?.name || 'Usuário'}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] font-bold text-mac-blue uppercase tracking-wider leading-none">
                {roleLabel}
              </span>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-none">·</span>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-none truncate">
                {departmentScopeText}
              </span>
            </div>
          </div>

          {/* Botão de Logout */}
          <button
            type="button"
            onClick={logout}
            title="Sair do sistema (Logout)"
            aria-label="Sair do sistema (Logout)"
            className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 flex items-center justify-center p-2 sm:ml-1 rounded-xl text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors focus:outline-none"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
