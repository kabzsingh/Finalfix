export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      email_subscriptions: {
        Row: {
          active: boolean
          created_at: string | null
          email: string
          id: string
          last_sent_at: string | null
          period: string
          site_id: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string | null
          email: string
          id?: string
          last_sent_at?: string | null
          period: string
          site_id: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string | null
          email?: string
          id?: string
          last_sent_at?: string | null
          period?: string
          site_id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_subscriptions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      readings: {
        Row: {
          id: number
          meter_id: string
          recorded_at: string
          site_id: string
          value: number
        }
        Insert: {
          id?: number
          meter_id: string
          recorded_at?: string
          site_id: string
          value: number
        }
        Update: {
          id?: number
          meter_id?: string
          recorded_at?: string
          site_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "readings_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "site_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "readings_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      report_send_log: {
        Row: {
          error: string | null
          id: number
          period_key: string
          recipients: string[]
          report_type: string
          sent_at: string
          site_id: string
          status: string
        }
        Insert: {
          error?: string | null
          id?: number
          period_key: string
          recipients?: string[]
          report_type: string
          sent_at?: string
          site_id: string
          status?: string
        }
        Update: {
          error?: string | null
          id?: number
          period_key?: string
          recipients?: string[]
          report_type?: string
          sent_at?: string
          site_id?: string
          status?: string
        }
        Relationships: []
      }
      site_api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          label: string | null
          last_used_at: string | null
          revoked: boolean
          site_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          label?: string | null
          last_used_at?: string | null
          revoked?: boolean
          site_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          label?: string | null
          last_used_at?: string | null
          revoked?: boolean
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_api_keys_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_meters: {
        Row: {
          capacity: number | null
          chemical_group: string | null
          created_at: string
          device_key: string
          id: string
          low_threshold: number | null
          meter_type: Database["public"]["Enums"]["meter_type"]
          name: string
          position: number
          site_id: string
          unit: string
        }
        Insert: {
          capacity?: number | null
          chemical_group?: string | null
          created_at?: string
          device_key: string
          id?: string
          low_threshold?: number | null
          meter_type: Database["public"]["Enums"]["meter_type"]
          name: string
          position?: number
          site_id: string
          unit?: string
        }
        Update: {
          capacity?: number | null
          chemical_group?: string | null
          created_at?: string
          device_key?: string
          id?: string
          low_threshold?: number | null
          meter_type?: Database["public"]["Enums"]["meter_type"]
          name?: string
          position?: number
          site_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_meters_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_operators: {
        Row: {
          created_at: string
          id: string
          site_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          site_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          site_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_operators_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          created_at: string
          daily_report_enabled: boolean
          id: string
          location: string | null
          low_chemical_threshold_pct: number
          monthly_report_enabled: boolean
          name: string
          report_hour: number
          report_recipients: string[]
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_report_enabled?: boolean
          id?: string
          location?: string | null
          low_chemical_threshold_pct?: number
          monthly_report_enabled?: boolean
          name: string
          report_hour?: number
          report_recipients?: string[]
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_report_enabled?: boolean
          id?: string
          location?: string | null
          low_chemical_threshold_pct?: number
          monthly_report_enabled?: boolean
          name?: string
          report_hour?: number
          report_recipients?: string[]
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      smtp_settings: {
        Row: {
          encryption: string
          from_email: string
          from_name: string
          host: string
          id: boolean
          password: string
          port: number
          updated_at: string | null
          user_email: string
        }
        Insert: {
          encryption?: string
          from_email: string
          from_name: string
          host: string
          id?: boolean
          password: string
          port?: number
          updated_at?: string | null
          user_email: string
        }
        Update: {
          encryption?: string
          from_email?: string
          from_name?: string
          host?: string
          id?: boolean
          password?: string
          port?: number
          updated_at?: string | null
          user_email?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bootstrap_first_admin: { Args: never; Returns: Json }
      can_access_site: {
        Args: { _site_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      ingest_readings: {
        Args: { p_readings: Json; p_site_api_key: string }
        Returns: undefined
      }
      meter_totals: {
        Args: { _site_id: string }
        Returns: {
          meter_id: string
          total: number
        }[]
      }
      meter_totals_since: {
        Args: { _since: string; _site_id: string }
        Returns: {
          meter_id: string
          total: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "operator"
      meter_type: "wash" | "fresh_water" | "chemical" | "chemical_flow"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operator"],
      meter_type: ["wash", "fresh_water", "chemical", "chemical_flow"],
    },
  },
} as const
