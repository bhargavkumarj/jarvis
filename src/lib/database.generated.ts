
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "ai_requests": {
                  Row: {
                    "attempt_id": string,"budget_month": string,"cached_tokens": number | null,"charged_paise": number,"created_at": string,"dispatched_at": string | null,"id": string,"input_bound": number,"input_tokens": number | null,"lease_until": string,"model": string,"output_bound": number,"output_tokens": number | null,"owner_id": string,"price_version": string,"provider_model": string | null,"provider_response_id": string | null,"purpose": string,"reasoning_tokens": number | null,"request_id": string,"reserved_paise": number,"scope_id": string,"settled_at": string | null,"settlement_hash": string,"state": string,"write12_tokens": number | null,"write30_tokens": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt_id": string,"budget_month": string,"cached_tokens"?: number | null,"charged_paise": number,"created_at"?: string,"dispatched_at"?: string | null,"id"?: string,"input_bound": number,"input_tokens"?: number | null,"lease_until"?: string,"model": string,"output_bound": number,"output_tokens"?: number | null,"owner_id": string,"price_version": string,"provider_model"?: string | null,"provider_response_id"?: string | null,"purpose": string,"reasoning_tokens"?: number | null,"request_id": string,"reserved_paise": number,"scope_id": string,"settled_at"?: string | null,"settlement_hash": string,"state": string,"write12_tokens"?: number | null,"write30_tokens"?: number | null
                  }
                  Update: {
                    "attempt_id"?: string,"budget_month"?: string,"cached_tokens"?: number | null,"charged_paise"?: number,"created_at"?: string,"dispatched_at"?: string | null,"id"?: string,"input_bound"?: number,"input_tokens"?: number | null,"lease_until"?: string,"model"?: string,"output_bound"?: number,"output_tokens"?: number | null,"owner_id"?: string,"price_version"?: string,"provider_model"?: string | null,"provider_response_id"?: string | null,"purpose"?: string,"reasoning_tokens"?: number | null,"request_id"?: string,"reserved_paise"?: number,"scope_id"?: string,"settled_at"?: string | null,"settlement_hash"?: string,"state"?: string,"write12_tokens"?: number | null,"write30_tokens"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_requests_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["owner_id"]
    }
                  ]
                },"conversations": {
                  Row: {
                    "created_at": string,"expires_at": string,"id": string,"owner_id": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at"?: string,"id"?: string,"owner_id": string,"title"?: string
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"id"?: string,"owner_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["owner_id"]
    }
                  ]
                },"delivery_attempts": {
                  Row: {
                    "error_code": string | null,"finished_at": string | null,"id": string,"job_id": string,"lease_until": string,"observation_recorded_at": string | null,"ordinal": number,"owner_id": string,"phone_observed": boolean | null,"phone_observed_at": string | null,"provider_reference": string | null,"reminder_id": string,"schedule_version": number,"send_started_at": string | null,"started_at": string,"state": string
                  }
                  ComputedFields: never
                  Insert: {
                    "error_code"?: string | null,"finished_at"?: string | null,"id"?: string,"job_id": string,"lease_until"?: string,"observation_recorded_at"?: string | null,"ordinal": number,"owner_id": string,"phone_observed"?: boolean | null,"phone_observed_at"?: string | null,"provider_reference"?: string | null,"reminder_id": string,"schedule_version": number,"send_started_at"?: string | null,"started_at"?: string,"state": string
                  }
                  Update: {
                    "error_code"?: string | null,"finished_at"?: string | null,"id"?: string,"job_id"?: string,"lease_until"?: string,"observation_recorded_at"?: string | null,"ordinal"?: number,"owner_id"?: string,"phone_observed"?: boolean | null,"phone_observed_at"?: string | null,"provider_reference"?: string | null,"reminder_id"?: string,"schedule_version"?: number,"send_started_at"?: string | null,"started_at"?: string,"state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "delivery_attempts_reminder_id_owner_id_fkey"
      columns: ["reminder_id","owner_id"]
isOneToOne: false
      referencedRelation: "reminders"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"memories": {
                  Row: {
                    "approved_at": string,"content": string,"id": string,"memory_key": string | null,"owner_id": string,"proposal_id": string | null,"source_date": string,"source_kind": string,"source_message_id": string | null,"state": string,"supersedes_id": string | null,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string,"content": string,"id"?: string,"memory_key"?: never,"owner_id": string,"proposal_id"?: string | null,"source_date": string,"source_kind"?: string,"source_message_id"?: string | null,"state"?: string,"supersedes_id"?: string | null,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "approved_at"?: string,"content"?: string,"id"?: string,"memory_key"?: never,"owner_id"?: string,"proposal_id"?: string | null,"source_date"?: string,"source_kind"?: string,"source_message_id"?: string | null,"state"?: string,"supersedes_id"?: string | null,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "memories_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["owner_id"]
    },{
      foreignKeyName: "memories_proposal_id_owner_id_fkey"
      columns: ["proposal_id","owner_id"]
isOneToOne: false
      referencedRelation: "memory_proposals"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "memories_source_message_id_owner_id_fkey"
      columns: ["source_message_id","owner_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "memories_supersedes_id_owner_id_fkey"
      columns: ["supersedes_id","owner_id"]
isOneToOne: false
      referencedRelation: "memories"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"memory_proposals": {
                  Row: {
                    "conflict_memory_id": string | null,"conflict_memory_version": number | null,"content": string,"created_at": string,"id": string,"origin": string,"owner_id": string,"source_message_id": string,"state": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "conflict_memory_id"?: string | null,"conflict_memory_version"?: number | null,"content": string,"created_at"?: string,"id"?: string,"origin"?: string,"owner_id": string,"source_message_id": string,"state"?: string,"version"?: number
                  }
                  Update: {
                    "conflict_memory_id"?: string | null,"conflict_memory_version"?: number | null,"content"?: string,"created_at"?: string,"id"?: string,"origin"?: string,"owner_id"?: string,"source_message_id"?: string,"state"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "memory_proposals_conflict_memory_id_owner_id_fkey"
      columns: ["conflict_memory_id","owner_id"]
isOneToOne: false
      referencedRelation: "memories"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "memory_proposals_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["owner_id"]
    },{
      foreignKeyName: "memory_proposals_source_message_id_owner_id_fkey"
      columns: ["source_message_id","owner_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "assistant_text": string,"attempt": string,"conversation_id": string,"created_at": string,"id": string,"lease_until": string,"owner_id": string,"provider_version": string,"request_id": string,"state": string,"used_memories": NonNullable<Json>,"user_text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assistant_text"?: string,"attempt"?: string,"conversation_id": string,"created_at"?: string,"id"?: string,"lease_until"?: string,"owner_id": string,"provider_version"?: string,"request_id": string,"state"?: string,"used_memories"?: NonNullable<Json>,"user_text": string
                  }
                  Update: {
                    "assistant_text"?: string,"attempt"?: string,"conversation_id"?: string,"created_at"?: string,"id"?: string,"lease_until"?: string,"owner_id"?: string,"provider_version"?: string,"request_id"?: string,"state"?: string,"used_memories"?: NonNullable<Json>,"user_text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_conversation_id_owner_id_fkey"
      columns: ["conversation_id","owner_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "messages_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["owner_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "assistant_name": string,"created_at": string,"display_name": string,"locale": string,"owner_id": string,"timezone": string,"tone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assistant_name"?: string,"created_at"?: string,"display_name"?: string,"locale"?: string,"owner_id": string,"timezone"?: string,"tone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "assistant_name"?: string,"created_at"?: string,"display_name"?: string,"locale"?: string,"owner_id"?: string,"timezone"?: string,"tone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"reminder_operations": {
                  Row: {
                    "created_at": string,"id": string,"idempotency_key": string,"kind": string,"owner_id": string,"reminder_id": string,"request_hash": string,"result": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"idempotency_key": string,"kind": string,"owner_id": string,"reminder_id": string,"request_hash": string,"result": NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"idempotency_key"?: string,"kind"?: string,"owner_id"?: string,"reminder_id"?: string,"request_hash"?: string,"result"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "reminder_operations_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["owner_id"]
    },{
      foreignKeyName: "reminder_operations_reminder_id_owner_id_fkey"
      columns: ["reminder_id","owner_id"]
isOneToOne: false
      referencedRelation: "reminders"
      referencedColumns: ["id","owner_id"]
    }
                  ]
                },"reminders": {
                  Row: {
                    "attempt_count": number,"cancel_requested_at": string | null,"channel": string,"channel_version": string | null,"confirm_operation_id": string | null,"confirmed_at": string | null,"created_at": string,"due_at": string,"enqueue_generation": number,"error_code": string | null,"expires_at": string,"finished_at": string | null,"id": string,"local_datetime": string,"next_attempt_at": string | null,"owner_id": string,"queue_job_id": string | null,"reconciled_at": string | null,"resolution": string,"scheduled_at": string | null,"state": string,"timezone": string,"title": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt_count"?: number,"cancel_requested_at"?: string | null,"channel"?: string,"channel_version"?: string | null,"confirm_operation_id"?: string | null,"confirmed_at"?: string | null,"created_at"?: string,"due_at": string,"enqueue_generation"?: number,"error_code"?: string | null,"expires_at": string,"finished_at"?: string | null,"id"?: string,"local_datetime": string,"next_attempt_at"?: string | null,"owner_id": string,"queue_job_id"?: string | null,"reconciled_at"?: string | null,"resolution": string,"scheduled_at"?: string | null,"state"?: string,"timezone": string,"title": string,"version"?: number
                  }
                  Update: {
                    "attempt_count"?: number,"cancel_requested_at"?: string | null,"channel"?: string,"channel_version"?: string | null,"confirm_operation_id"?: string | null,"confirmed_at"?: string | null,"created_at"?: string,"due_at"?: string,"enqueue_generation"?: number,"error_code"?: string | null,"expires_at"?: string,"finished_at"?: string | null,"id"?: string,"local_datetime"?: string,"next_attempt_at"?: string | null,"owner_id"?: string,"queue_job_id"?: string | null,"reconciled_at"?: string | null,"resolution"?: string,"scheduled_at"?: string | null,"state"?: string,"timezone"?: string,"title"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "reminders_confirm_operation_id_owner_id_fkey"
      columns: ["confirm_operation_id","owner_id"]
isOneToOne: false
      referencedRelation: "reminder_operations"
      referencedColumns: ["id","owner_id"]
    },{
      foreignKeyName: "reminders_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["owner_id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "m2a_create_conversation_v1":
{ Args: { "p_title"?: string }; Returns: Json
                           },
"m2a_delete_conversation_v1":
{ Args: { "p_id": string }; Returns: undefined
                           },
"m2a_end_turn_v1":
{ Args: { "p_attempt": string,"p_id": string,"p_state": string,"p_text"?: string,"p_used"?: Json }; Returns: Json
                           },
"m2a_memory_v1":
{ Args: { "p_action": string,"p_content"?: string,"p_id": string,"p_replace"?: string,"p_replace_version"?: number,"p_version": number }; Returns: Json
                           },
"m2a_retrieve_v1":
{ Args: { "p_query": string }; Returns: Json
                           },
"m2a_start_turn_v1":
{ Args: { "p_conversation": string,"p_request": string,"p_text": string }; Returns: Json
                           },
"m2b_reminder_v1":
{ Args: { "p_action": string,"p_data": Json,"p_request": string }; Returns: Json
                           },
"m2c_ai_account_v1":
{ Args: { "p_action": string,"p_id": string,"p_token": string,"p_usage"?: Json }; Returns: Json
                           },
"m2c_ai_budget_v1":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"m2c_ai_reserve_v1":
{ Args: { "p_attempt": string,"p_hash": string,"p_input": number,"p_model": string,"p_output": number,"p_purpose": string,"p_request": string }; Returns: Json
                           },
"m2c_approve_memory_v1":
{ Args: { "p_content": string,"p_id": string,"p_replace"?: string,"p_replace_version"?: number,"p_reviewed": boolean,"p_version": number }; Returns: Json
                           },
"m2c_capabilities_v1":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"m2c_cleanup_self_v1":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"m2c_finish_turn_v1":
{ Args: { "p_attempt": string,"p_id": string,"p_model": string,"p_proposal": Json,"p_text": string,"p_used": Json }; Returns: Json
                           },
"m2c_live_readiness_v1":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"m2c_mark_turn_v1":
{ Args: { "p_attempt": string,"p_id": string,"p_model": string }; Returns: undefined
                           },
"m2c_observe_phone_v1":
{ Args: { "p_at": string,"p_attempt": string,"p_observed": boolean }; Returns: undefined
                           },
"revoke_current_session":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
