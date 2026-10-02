-- In-flight logins from the removed Codex flow cannot complete with SiWC.
-- Linked account rows remain encrypted and removable during the transition.
DELETE FROM `ai_device_logins` WHERE `provider` = 'openai';
