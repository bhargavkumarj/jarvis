// Application contract reviewed against regenerated M1 + M2A/B/C schema on 2026-10-29.
// SQL CHECK-constrained tone/locale are narrower here than generated string types.
// ai_requests intentionally omits ungranted settlement_hash/scope_id columns.
// Recurrence/voice/tasks/privacy/onboarding additions below are provisional source
// contracts, NOT regenerated database evidence. Run db:types after all migrations.
// Computer-control (202611050001) tables/RPCs below are likewise provisional source contracts.
import type { Conversation, Turn, Proposal, Memory } from "./conversation/types";
import type { Reminder, ReminderOperation, DeliveryAttempt } from "./reminders/types";
import type { ReminderSeries } from "./reminders/recurrence";
import type {Task,TaskOperation} from "./tasks/model";
import type { Json } from "./database.generated";
type ContentTable<T> = { Row: T; Insert: Partial<T>; Update: Partial<T>; Relationships: [] };
export type Profile = {
  owner_id: string; display_name: string; assistant_name: string;
  tone: "balanced" | "concise" | "warm"; timezone: string;
  locale: "en-IN" | "en-GB" | "en-US"; created_at: string; updated_at: string;
  onboarding_completed_at?: string | null;
};
export type Database = {
  public: {
    Tables: {
      privacy_preferences: ContentTable<import("./privacy/model").PrivacyPreferences>;
      computer_settings: ContentTable<{owner_id:string;enabled:boolean;consent_version:string|null;updated_at:string}>;
      computer_devices: ContentTable<import("./computer/service").DeviceRow>;
      computer_commands: ContentTable<{id:string;owner_id:string;device_id:string;request_id:string;source:'text'|'voice';actions:Json;labels:Json;digest:string;state:string;auto_eligible:boolean;created_at:string;proposal_expires_at:string;authorized_at:string|null;ticket_expires_at:string|null;claimed_at:string|null;finished_at:string|null;cancel_requested_at:string|null;results:Json;summary:string|null}>;
      tasks: ContentTable<Task>;
      task_operations: ContentTable<TaskOperation>;
      voice_preferences: ContentTable<{owner_id:string;cloud_transcription:boolean;consent_version:string|null;updated_at:string}>;
      ai_requests: ContentTable<{id:string;owner_id:string;request_id:string;attempt_id:string;purpose:string;model:string;price_version:string;budget_month:string;input_bound:number;output_bound:number;reserved_paise:number;charged_paise:number;state:string;created_at:string;lease_until:string;dispatched_at:string|null;settled_at:string|null;input_tokens:number|null;output_tokens:number|null;cached_tokens:number|null;write30_tokens:number|null;write12_tokens:number|null;reasoning_tokens:number|null;provider_model:string|null;provider_response_id:string|null;audio_milliseconds:number|null;reported_audio_seconds:number|null}>;
      reminders: ContentTable<Reminder>;
      reminder_series: ContentTable<ReminderSeries>;
      series_operations: ContentTable<{id:string;owner_id:string;series_id:string;idempotency_key:string;kind:string;request_hash:string;result:Json;created_at:string}>;
      reminder_operations: ContentTable<ReminderOperation>;
      delivery_attempts: ContentTable<DeliveryAttempt>;
      conversations: ContentTable<Conversation>;
      messages: ContentTable<Turn>;
      memory_proposals: ContentTable<Proposal>;
      memories: ContentTable<Memory>;
      profiles: {
        Row: Profile;
        Insert: { owner_id: string } & Partial<Omit<Profile, "owner_id">>;
        Update: Partial<Profile>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      privacy_action_v1: {Args:{p_kind:string;p_action:string;p_request:string;p_conversation:string;p_data:Json};Returns:Json};
      computer_settings_v1: {Args:{p_enabled?:boolean|null;p_consent?:string|null};Returns:Json};
      computer_pairing_begin_v1: {Args:{p_id:string;p_code_hash:string;p_extension:string;p_origin:string};Returns:Json};
      computer_propose_v1: {Args:{p_command:string;p_request:string;p_device:string;p_source:string;p_actions:Json;p_labels:Json;p_digest:string;p_auto:boolean};Returns:Json};
      computer_authorize_v1: {Args:{p_command:string;p_digest:string;p_ticket_hash:string};Returns:Json};
      computer_cancel_v1: {Args:{p_command:string};Returns:Json};
      computer_device_v1: {Args:{p_action:string;p_device:string};Returns:Json};
      computer_history_clear_v1: {Args:Record<string,never>;Returns:Json};
      computer_export_v1: {Args:{p_category:string;p_after?:string|null;p_at?:string;p_epoch?:number};Returns:Json};
      computer_pairing_inspect_v1: {Args:{p_pairing:string;p_code:string;p_extension:string};Returns:Json};
      computer_pairing_complete_v1: {Args:{p_pairing:string;p_code:string;p_extension:string;p_name:string;p_credential_hash:string};Returns:Json};
      computer_device_sync_v1: {Args:{p_device:string;p_secret:string;p_sync:Json};Returns:Json};
      computer_redeem_v1: {Args:{p_device:string;p_secret:string;p_command:string;p_ticket:string};Returns:Json};
      computer_progress_v1: {Args:{p_device:string;p_secret:string;p_command:string;p_state:string;p_index:number};Returns:Json};
      computer_finish_v1: {Args:{p_device:string;p_secret:string;p_command:string;p_result:Json};Returns:Json};
      computer_device_unpair_v1: {Args:{p_device:string;p_secret:string};Returns:Json};
      privacy_get_v1: {Args:Record<string,never>;Returns:Json};
      privacy_reauth_check_v1: {Args:Record<string,never>;Returns:undefined};
      privacy_command_v1: {Args:{p_action:string;p_request:string;p_data:Json};Returns:Json};
      privacy_receipt_v1: {Args:{p_request:string;p_token:string;p_retry?:boolean};Returns:Json};
      privacy_own_deletion_v1: {Args:Record<string,never>;Returns:Json};
      privacy_export_v1: {Args:{p_category:string;p_after?:string|null;p_at?:string;p_epoch?:number};Returns:Json};
      privacy_context_v1: {Args:{p_conversation?:string|null;p_epoch?:number|null};Returns:undefined};
      task_command_v1: {Args:{p_action:string;p_request:string;p_data:Json};Returns:Json};
      task_context_v1: {Args:{p_query?:string|null;p_overdue?:boolean;p_focus?:string|null};Returns:Json};
      voice_settings_v1: {Args:{p_enabled:boolean;p_consent:string|null};Returns:Json};
      voice_reserve_v1: {Args:{p_request:string;p_milliseconds:number;p_hash:string};Returns:Json};
      voice_account_v1: {Args:{p_action:string;p_id:string;p_token:string;p_seconds?:number};Returns:Json};
      reminder_series_v1: { Args: {p_action:string;p_request:string;p_data:Json}; Returns:Json };
      reminder_snooze_v1: { Args: {p_request:string;p_data:Json}; Returns:Json };
      m2b_reminder_v1: { Args: { p_action: string; p_request: string; p_data: Json }; Returns: Json };
      m2c_capabilities_v1: { Args: Record<string, never>; Returns: Json };
      m2c_observe_phone_v1: { Args: { p_attempt: string; p_observed: boolean; p_at: string }; Returns: undefined };
      m2c_ai_reserve_v1: { Args: { p_request: string; p_attempt: string; p_purpose: string; p_model: string; p_input: number; p_output: number; p_hash: string }; Returns: Json };
      m2c_ai_account_v1: { Args: { p_action: string; p_id: string; p_token: string; p_usage?: Json | null }; Returns: Json };
      m2c_ai_budget_v1: { Args: Record<string, never>; Returns: Json };
      m2c_mark_turn_v1: { Args: {p_id:string;p_attempt:string;p_model:string}; Returns: undefined };
      m2c_finish_turn_v1: { Args: { p_id: string; p_attempt: string; p_text: string; p_used: Json; p_proposal: Json | null; p_model: string }; Returns: Json };
      m2c_approve_memory_v1: { Args: { p_id: string; p_version: number; p_content: string; p_reviewed: boolean; p_replace?: string | null; p_replace_version?: number | null }; Returns: Json };
      m2c_cleanup_self_v1: { Args: Record<string, never>; Returns: Json };
      m2c_live_readiness_v1: { Args: Record<string, never>; Returns: Json };
      revoke_current_session: { Args: Record<string, never>; Returns: undefined };
      m2a_create_conversation_v1: { Args: { p_title?: string }; Returns: Json };
      m2a_delete_conversation_v1: { Args: { p_id: string }; Returns: undefined };
      m2a_start_turn_v1: { Args: { p_conversation: string; p_request: string; p_text: string }; Returns: Json };
      m2a_end_turn_v1: { Args: { p_id: string; p_attempt: string; p_state: string; p_text?: string; p_used?: Json }; Returns: Json };
      m2a_retrieve_v1: { Args: { p_query: string }; Returns: Json };
      m2a_memory_v1: { Args: { p_action: string; p_id: string; p_version: number; p_content?: string; p_replace?: string | null; p_replace_version?: number | null }; Returns: Json };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
