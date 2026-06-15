-- Up: tenant relationship guardrails for hosted-safe data integrity

CREATE OR REPLACE FUNCTION crmy_assert_user_tenant(p_tenant_id UUID, p_user_id UUID, p_label TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE tenant_id = p_tenant_id AND id = p_user_id) THEN
    RAISE EXCEPTION '% must reference a user in the same tenant', p_label
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION crmy_assert_actor_tenant(p_tenant_id UUID, p_actor_id UUID, p_label TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM actors WHERE tenant_id = p_tenant_id AND id = p_actor_id) THEN
    RAISE EXCEPTION '% must reference an actor in the same tenant', p_label
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION crmy_assert_subject_tenant(p_tenant_id UUID, p_subject_type TEXT, p_subject_id UUID, p_label TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_subject_type IS NULL OR p_subject_id IS NULL THEN
    RETURN;
  END IF;

  IF p_subject_type = 'account' AND EXISTS (SELECT 1 FROM accounts WHERE tenant_id = p_tenant_id AND id = p_subject_id) THEN
    RETURN;
  ELSIF p_subject_type = 'contact' AND EXISTS (SELECT 1 FROM contacts WHERE tenant_id = p_tenant_id AND id = p_subject_id) THEN
    RETURN;
  ELSIF p_subject_type = 'opportunity' AND EXISTS (SELECT 1 FROM opportunities WHERE tenant_id = p_tenant_id AND id = p_subject_id) THEN
    RETURN;
  ELSIF p_subject_type = 'use_case' AND EXISTS (SELECT 1 FROM use_cases WHERE tenant_id = p_tenant_id AND id = p_subject_id) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION '% must reference a subject in the same tenant', p_label
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION crmy_assert_core_record_tenant_refs()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'accounts' THEN
    PERFORM crmy_assert_subject_tenant(NEW.tenant_id, 'account', NEW.parent_id, 'accounts.parent_id');
    PERFORM crmy_assert_user_tenant(NEW.tenant_id, NEW.owner_id, 'accounts.owner_id');
    PERFORM crmy_assert_user_tenant(NEW.tenant_id, NEW.created_by, 'accounts.created_by');
  ELSIF TG_TABLE_NAME = 'contacts' THEN
    PERFORM crmy_assert_subject_tenant(NEW.tenant_id, 'account', NEW.account_id, 'contacts.account_id');
    PERFORM crmy_assert_user_tenant(NEW.tenant_id, NEW.owner_id, 'contacts.owner_id');
    PERFORM crmy_assert_user_tenant(NEW.tenant_id, NEW.created_by, 'contacts.created_by');
  ELSIF TG_TABLE_NAME = 'opportunities' THEN
    PERFORM crmy_assert_subject_tenant(NEW.tenant_id, 'account', NEW.account_id, 'opportunities.account_id');
    PERFORM crmy_assert_subject_tenant(NEW.tenant_id, 'contact', NEW.contact_id, 'opportunities.contact_id');
    PERFORM crmy_assert_user_tenant(NEW.tenant_id, NEW.owner_id, 'opportunities.owner_id');
    PERFORM crmy_assert_user_tenant(NEW.tenant_id, NEW.created_by, 'opportunities.created_by');
  ELSIF TG_TABLE_NAME = 'use_cases' THEN
    PERFORM crmy_assert_subject_tenant(NEW.tenant_id, 'account', NEW.account_id, 'use_cases.account_id');
    PERFORM crmy_assert_subject_tenant(NEW.tenant_id, 'opportunity', NEW.opportunity_id, 'use_cases.opportunity_id');
    PERFORM crmy_assert_user_tenant(NEW.tenant_id, NEW.owner_id, 'use_cases.owner_id');
    PERFORM crmy_assert_user_tenant(NEW.tenant_id, NEW.created_by, 'use_cases.created_by');
  ELSIF TG_TABLE_NAME = 'activities' THEN
    PERFORM crmy_assert_subject_tenant(NEW.tenant_id, 'contact', NEW.contact_id, 'activities.contact_id');
    PERFORM crmy_assert_subject_tenant(NEW.tenant_id, 'account', NEW.account_id, 'activities.account_id');
    PERFORM crmy_assert_subject_tenant(NEW.tenant_id, 'opportunity', NEW.opportunity_id, 'activities.opportunity_id');
    PERFORM crmy_assert_subject_tenant(NEW.tenant_id, 'use_case', NEW.use_case_id, 'activities.use_case_id');
    PERFORM crmy_assert_subject_tenant(NEW.tenant_id, NEW.subject_type, NEW.subject_id, 'activities.subject');
    PERFORM crmy_assert_user_tenant(NEW.tenant_id, NEW.owner_id, 'activities.owner_id');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION crmy_assert_context_subject_tenant_refs()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM crmy_assert_subject_tenant(NEW.tenant_id, NEW.subject_type, NEW.subject_id, TG_TABLE_NAME || '.subject');
  IF TG_TABLE_NAME = 'context_entries' THEN
    PERFORM crmy_assert_actor_tenant(NEW.tenant_id, NEW.authored_by, 'context_entries.authored_by');
  ELSIF TG_TABLE_NAME = 'raw_context_sources' THEN
    PERFORM crmy_assert_actor_tenant(NEW.tenant_id, NEW.actor_id, 'raw_context_sources.actor_id');
  ELSIF TG_TABLE_NAME = 'signal_groups' THEN
    PERFORM crmy_assert_actor_tenant(NEW.tenant_id, NEW.dismissed_by, 'signal_groups.dismissed_by');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION crmy_assert_assignment_tenant_refs()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM crmy_assert_actor_tenant(NEW.tenant_id, NEW.assigned_by, 'assignments.assigned_by');
  PERFORM crmy_assert_actor_tenant(NEW.tenant_id, NEW.assigned_to, 'assignments.assigned_to');
  PERFORM crmy_assert_subject_tenant(NEW.tenant_id, NEW.subject_type, NEW.subject_id, 'assignments.subject');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION crmy_assert_use_case_contact_tenant_refs()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  uc_tenant UUID;
  contact_tenant UUID;
BEGIN
  SELECT tenant_id INTO uc_tenant FROM use_cases WHERE id = NEW.use_case_id;
  SELECT tenant_id INTO contact_tenant FROM contacts WHERE id = NEW.contact_id;
  IF uc_tenant IS NULL OR contact_tenant IS NULL OR uc_tenant <> contact_tenant THEN
    RAISE EXCEPTION 'use_case_contacts must reference records in the same tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION crmy_assert_signal_group_member_tenant_refs()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM signal_groups WHERE tenant_id = NEW.tenant_id AND id = NEW.signal_group_id) THEN
    RAISE EXCEPTION 'signal_group_members.signal_group_id must reference a group in the same tenant'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM context_entries WHERE tenant_id = NEW.tenant_id AND id = NEW.context_entry_id) THEN
    RAISE EXCEPTION 'signal_group_members.context_entry_id must reference context in the same tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['accounts', 'contacts', 'opportunities', 'use_cases', 'activities']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'crmy_tenant_guard_' || table_name, table_name);
    EXECUTE format(
      'CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION crmy_assert_core_record_tenant_refs()',
      'crmy_tenant_guard_' || table_name,
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY['context_entries', 'raw_context_sources', 'signal_groups']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'crmy_tenant_guard_' || table_name, table_name);
    EXECUTE format(
      'CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION crmy_assert_context_subject_tenant_refs()',
      'crmy_tenant_guard_' || table_name,
      table_name
    );
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS crmy_tenant_guard_assignments ON assignments;
CREATE CONSTRAINT TRIGGER crmy_tenant_guard_assignments
AFTER INSERT OR UPDATE ON assignments
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION crmy_assert_assignment_tenant_refs();

DROP TRIGGER IF EXISTS crmy_tenant_guard_use_case_contacts ON use_case_contacts;
CREATE CONSTRAINT TRIGGER crmy_tenant_guard_use_case_contacts
AFTER INSERT OR UPDATE ON use_case_contacts
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION crmy_assert_use_case_contact_tenant_refs();

DROP TRIGGER IF EXISTS crmy_tenant_guard_signal_group_members ON signal_group_members;
CREATE CONSTRAINT TRIGGER crmy_tenant_guard_signal_group_members
AFTER INSERT OR UPDATE ON signal_group_members
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION crmy_assert_signal_group_member_tenant_refs();

-- Down:
-- DROP TRIGGER IF EXISTS crmy_tenant_guard_signal_group_members ON signal_group_members;
-- DROP TRIGGER IF EXISTS crmy_tenant_guard_use_case_contacts ON use_case_contacts;
-- DROP TRIGGER IF EXISTS crmy_tenant_guard_assignments ON assignments;
-- DROP FUNCTION IF EXISTS crmy_assert_signal_group_member_tenant_refs();
-- DROP FUNCTION IF EXISTS crmy_assert_use_case_contact_tenant_refs();
-- DROP FUNCTION IF EXISTS crmy_assert_assignment_tenant_refs();
-- DROP FUNCTION IF EXISTS crmy_assert_context_subject_tenant_refs();
-- DROP FUNCTION IF EXISTS crmy_assert_core_record_tenant_refs();
-- DROP FUNCTION IF EXISTS crmy_assert_subject_tenant(UUID, TEXT, UUID, TEXT);
-- DROP FUNCTION IF EXISTS crmy_assert_actor_tenant(UUID, UUID, TEXT);
-- DROP FUNCTION IF EXISTS crmy_assert_user_tenant(UUID, UUID, TEXT);
