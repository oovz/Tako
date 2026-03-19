/**
 * SettingsSection - Reusable card wrapper for settings groups
 * Provides consistent styling and layout for settings sections
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/src/shared/utils"
import type { ReactNode } from "react"

interface SettingsSectionProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
  icon?: ReactNode
}

export function SettingsSection({ title, description, children, className, icon }: SettingsSectionProps) {
  return (
    <Card className={cn("transition-shadow hover:shadow-md", className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          {icon && <span className="text-primary">{icon}</span>}
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
      </CardContent>
    </Card>
  )
}

