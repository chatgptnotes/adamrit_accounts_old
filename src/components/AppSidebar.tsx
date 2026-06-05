
import { useState } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import { Input } from '@/components/ui/input';
import { Search, ChevronDown } from 'lucide-react';
import { AppSidebarProps, MenuItem } from './sidebar/types';
import { useMenuItems } from './sidebar/useMenuItems';
import { SidebarMenuItem } from './sidebar/SidebarMenuItem';
import { SidebarHeaderComponent } from './sidebar/SidebarHeaderComponent';
import { GROUP_ORDER } from './sidebar/sidebarGroups';

export function AppSidebar(props: AppSidebarProps) {
  const { mainItems, masterItems } = useMenuItems(props);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const q = search.toLowerCase();
  const searching = q.length > 0;

  const filteredMain = mainItems.filter(item =>
    item.title.toLowerCase().includes(q)
  );
  const filteredMasters = masterItems.filter(item =>
    item.title.toLowerCase().includes(q)
  );

  // Bucket the main items by their group, preserving GROUP_ORDER.
  const groupsToRender = GROUP_ORDER
    .map(name => ({ name, items: filteredMain.filter(i => (i.group || 'More') === name) }))
    .filter(g => g.items.length > 0);

  const toggle = (name: string) =>
    setCollapsed(prev => ({ ...prev, [name]: !prev[name] }));

  const renderGroup = (name: string, items: MenuItem[]) => {
    // While searching, force-expand so matches are always visible.
    const isOpen = searching || !collapsed[name];
    return (
      <SidebarGroup key={name}>
        <SidebarGroupLabel
          asChild
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer"
        >
          <button type="button" onClick={() => toggle(name)} className="flex w-full items-center justify-between">
            <span>{name}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${isOpen ? '' : '-rotate-90'}`}
            />
          </button>
        </SidebarGroupLabel>
        {isOpen && (
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        )}
      </SidebarGroup>
    );
  };

  return (
    <Sidebar>
      <SidebarHeaderComponent />
      <SidebarContent>
        <SidebarGroup>
          <div className="px-2 mb-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tabs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8"
              />
            </div>
          </div>
        </SidebarGroup>

        {groupsToRender.map(g => renderGroup(g.name, g.items))}

        {filteredMasters.length > 0 && (
          <>
            <SidebarSeparator />
            {renderGroup('Masters', filteredMasters)}
          </>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
