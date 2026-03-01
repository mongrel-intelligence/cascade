-- Migrate global agent_config prompts into agent_definitions JSONB.
-- For each global agent_config row that has a prompt or task_prompt,
-- upsert into agent_definitions merging the prompts section into the definition JSONB.

DO $$
DECLARE
  r RECORD;
  existing_def JSONB;
  prompts_patch JSONB;
BEGIN
  FOR r IN
    SELECT agent_type, prompt, task_prompt
    FROM agent_configs
    WHERE project_id IS NULL
      AND (prompt IS NOT NULL OR task_prompt IS NOT NULL)
  LOOP
    -- Build the prompts patch object
    prompts_patch := '{}'::JSONB;
    IF r.prompt IS NOT NULL THEN
      prompts_patch := prompts_patch || jsonb_build_object('systemPrompt', r.prompt);
    END IF;
    IF r.task_prompt IS NOT NULL THEN
      prompts_patch := prompts_patch || jsonb_build_object('taskPrompt', r.task_prompt);
    END IF;

    -- Check if agent_definitions already has a row for this agent_type
    SELECT definition INTO existing_def
    FROM agent_definitions
    WHERE agent_type = r.agent_type;

    IF existing_def IS NOT NULL THEN
      -- Merge prompts into the existing definition
      UPDATE agent_definitions
      SET definition = definition || jsonb_build_object('prompts', prompts_patch),
          updated_at = now()
      WHERE agent_type = r.agent_type;
    ELSE
      -- No definition row yet — skip (prompts will be in definition when it's created)
      -- We cannot create a full definition from scratch here without all required fields
      RAISE NOTICE 'Skipping prompts for agent_type=% (no definition row exists)', r.agent_type;
      NULL;
    END IF;
  END LOOP;
END $$;

-- Drop the prompt and task_prompt columns from agent_configs
ALTER TABLE agent_configs DROP COLUMN IF EXISTS prompt;
ALTER TABLE agent_configs DROP COLUMN IF EXISTS task_prompt;
