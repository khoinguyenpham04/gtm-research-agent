"use client"

import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavThreads } from "@/components/nav-threads"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  LayoutDashboardIcon,
  HomeIcon,
  Settings2Icon,
  CircleHelpIcon,
  DatabaseIcon,
  SearchIcon,
  HistoryIcon,
} from "lucide-react"
import Link from "next/link"
import Image from "next/image"

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    {
      title: "Home",
      url: "/dashboard",
      icon: (
        <HomeIcon
        />
      ),
    },
    {
      title: "Deep Research",
      url: "/dashboard/deepresearch",
      icon: (
        <LayoutDashboardIcon
        />
      ),
    },
    {
      title: "Recent Runs",
      url: "/dashboard/recent",
      icon: (
        <HistoryIcon
        />
      ),
    },
    {
      title: "Data Library",
      url: "/dashboard/data-library",
      icon: (
        <DatabaseIcon
        />
      ),
    },
    {
      title: "RAG Search",
      url: "/dashboard/rag-search",
      icon: (
        <SearchIcon
        />
      ),
    },
  ],
  navSecondary: [
    {
      title: "Settings",
      url: "#",
      icon: (
        <Settings2Icon
        />
      ),
    },
    {
      title: "Get Help",
      url: "#",
      icon: (
        <CircleHelpIcon
        />
      ),
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <Link href="/dashboard">
                <Image
                  src="/logo.png"
                  alt="Clarion logo"
                  width={28}
                  height={28}
                  className="size-7 rounded-sm"
                  priority
                />
                <span className="text-base font-semibold">Clarion</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavThreads />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
