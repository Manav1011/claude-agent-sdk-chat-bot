import React, { useState } from 'react';
import { useChat } from '../../context/ChatContext';

export default function SettingsModal() {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    permissionMode,
    setPermissionMode,
    settingSources,
    setSettingSources,
    skillsMode,
    setSkillsMode,
    skillsList,
    setSkillsList,
    speechExplanation,
    setSpeechExplanation,
  } = useChat();

  const [newSkillText, setNewSkillText] = useState('');

  if (!isSettingsOpen) return null;

  const currentPerm = permissionMode || 'default';
  const currentSources = settingSources
    ? settingSources.includes('user')
      ? 'user'
      : settingSources.includes('local')
      ? 'local'
      : 'default'
    : 'default';
  const currentSkillsMode = skillsMode || 'default';

  // Permission description
  let permDesc = 'null (SDK Default: Standard tool permission checks)';
  if (currentPerm === 'read_only') {
    permDesc = '"read_only" (Read-only: Read, Glob, Grep, WebFetch, WebSearch — no Bash/Write/Edit)';
  } else if (currentPerm === 'bypassPermissions') {
    permDesc = '"bypassPermissions" (Full Access: All tool checks bypassed)';
  } else if (currentPerm === 'plan') {
    permDesc = '"plan" (Plan mode: agent drafts a plan and waits for ExitPlanMode approval)';
  }

  // Source description
  let sourceDesc = 'null (Loads user + project + local settings — SDK default)';
  if (currentSources === 'user') {
    sourceDesc = '["user"] (Only load ~/.claude/settings.json)';
  } else if (currentSources === 'local') {
    sourceDesc = '["local"] (Only load .claude/settings.local.json)';
  }

  // Skills description
  let skillsDesc = 'null (SDK default: standard CLI discovery)';
  if (currentSkillsMode === 'none') {
    skillsDesc = '[] (No skills at all: empty list)';
  } else if (currentSkillsMode === 'custom') {
    const count = (skillsList || []).length;
    skillsDesc = `[${(skillsList || []).map((s) => `"${s}"`).join(', ')}] (${count} skills enabled)`;
  }

  const handleAddSkill = () => {
    const val = newSkillText.trim();
    if (!val) return;
    if (!skillsList.includes(val)) {
      setSkillsList([...skillsList, val]);
    }
    setNewSkillText('');
  };

  const handleRemoveSkill = (index) => {
    const nextList = [...skillsList];
    nextList.splice(index, 1);
    setSkillsList(nextList);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-msg p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsSettingsOpen(false);
      }}
    >
      <div className="bg-dark-surface border border-dark-border rounded-2xl p-5 w-full max-w-lg shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-dark-border/60">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.75"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.75"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <h3 className="font-medium text-sm text-white">Agent & Session Settings</h3>
          </div>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(false)}
            className="text-txt-subtle hover:text-white p-1 rounded-lg hover:bg-dark-elevated transition-colors text-base leading-none cursor-pointer"
          >
            &times;
          </button>
        </div>

        <div className="space-y-3.5 py-1">
          {/* 1. Permission Mode */}
          <div className="p-3 rounded-xl bg-dark-elevated/40 border border-dark-border/60 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-white">Permission Mode</div>
                <div className="text-[11px] text-txt-subtle">Controls what the agent is allowed to do</div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1 bg-dark-bg/80 p-1 rounded-lg border border-dark-border/60 text-[11px] font-medium">
              <button
                type="button"
                onClick={() => setPermissionMode(null)}
                className={`py-1 rounded transition-colors text-center cursor-pointer ${
                  currentPerm === 'default'
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-txt-subtle hover:text-white'
                }`}
              >
                Default
              </button>
              <button
                type="button"
                onClick={() => setPermissionMode('read_only')}
                className={`py-1 rounded transition-colors text-center cursor-pointer ${
                  currentPerm === 'read_only'
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-txt-subtle hover:text-white'
                }`}
              >
                Read-Only
              </button>
              <button
                type="button"
                onClick={() => setPermissionMode('bypassPermissions')}
                className={`py-1 rounded transition-colors text-center cursor-pointer ${
                  currentPerm === 'bypassPermissions'
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-txt-subtle hover:text-white'
                }`}
              >
                Full Access
              </button>
              <button
                type="button"
                onClick={() => setPermissionMode('plan')}
                className={`py-1 rounded transition-colors text-center cursor-pointer ${
                  currentPerm === 'plan'
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-txt-subtle hover:text-white'
                }`}
              >
                Plan
              </button>
            </div>
            <div className="text-[10px] text-txt-subtle font-mono">{permDesc}</div>
          </div>

          {/* 2. Settings Sources */}
          <div className="p-3 rounded-xl bg-dark-elevated/40 border border-dark-border/60 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-white">Settings Sources</div>
                <div className="text-[11px] text-txt-subtle">Choose which Claude config files to load</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1 bg-dark-bg/80 p-1 rounded-lg border border-dark-border/60 text-[11px] font-medium">
              <button
                type="button"
                onClick={() => setSettingSources(null)}
                className={`py-1 rounded transition-colors text-center cursor-pointer ${
                  currentSources === 'default'
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-txt-subtle hover:text-white'
                }`}
              >
                Default (All)
              </button>
              <button
                type="button"
                onClick={() => setSettingSources(['user'])}
                className={`py-1 rounded transition-colors text-center cursor-pointer ${
                  currentSources === 'user'
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-txt-subtle hover:text-white'
                }`}
              >
                User (~/.claude)
              </button>
              <button
                type="button"
                onClick={() => setSettingSources(['local'])}
                className={`py-1 rounded transition-colors text-center cursor-pointer ${
                  currentSources === 'local'
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-txt-subtle hover:text-white'
                }`}
              >
                Local (.claude)
              </button>
            </div>
            <div className="text-[10px] text-txt-subtle font-mono">{sourceDesc}</div>
          </div>

          {/* 3. Skills Configurations */}
          <div className="p-3 rounded-xl bg-dark-elevated/40 border border-dark-border/60 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-white">Skills Configuration</div>
                <div className="text-[11px] text-txt-subtle">
                  Controls which skills are available in the session
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1 bg-dark-bg/80 p-1 rounded-lg border border-dark-border/60 text-[10px] sm:text-[11px] font-medium">
              <button
                type="button"
                onClick={() => setSkillsMode('default')}
                className={`py-1 rounded transition-colors text-center cursor-pointer ${
                  currentSkillsMode === 'default'
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-txt-subtle hover:text-white'
                }`}
              >
                Default
              </button>
              <button
                type="button"
                onClick={() => setSkillsMode('none')}
                className={`py-1 rounded transition-colors text-center cursor-pointer ${
                  currentSkillsMode === 'none'
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-txt-subtle hover:text-white'
                }`}
              >
                No Skills
              </button>
              <button
                type="button"
                onClick={() => setSkillsMode('custom')}
                className={`py-1 rounded transition-colors text-center cursor-pointer ${
                  currentSkillsMode === 'custom'
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-txt-subtle hover:text-white'
                }`}
              >
                Custom
              </button>
            </div>

            {/* Custom Skills Tag Input Container */}
            {currentSkillsMode === 'custom' && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newSkillText}
                    onChange={(e) => setNewSkillText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddSkill();
                      }
                    }}
                    placeholder="e.g. writing-plans, agent-reach..."
                    className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-2.5 py-1 text-xs text-white placeholder-txt-subtle focus:outline-none focus:border-brand/60 font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleAddSkill}
                    className="px-2.5 py-1 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-medium transition-colors cursor-pointer"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 bg-dark-bg/60 rounded-lg border border-dark-border/40 min-h-[32px]">
                  {skillsList.length === 0 ? (
                    <span className="text-[11px] text-txt-subtle italic p-1">
                      No custom skills added (sends empty list [])
                    </span>
                  ) : (
                    skillsList.map((skillName, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-dark-surface border border-dark-border text-white text-[11px] font-mono shadow-sm"
                      >
                        <span>{skillName}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveSkill(idx)}
                          className="text-txt-subtle hover:text-red-400 font-sans ml-0.5 leading-none cursor-pointer"
                        >
                          &times;
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            )}
            <div className="text-[10px] text-txt-subtle font-mono">{skillsDesc}</div>
          </div>

          {/* 4. Speech Explanation Toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-dark-elevated/40 border border-dark-border/60">
            <div className="space-y-0.5 pr-4">
              <div className="text-xs font-medium text-white">Speech Explanation</div>
              <div className="text-[11px] text-txt-subtle leading-relaxed">
                Enable spoken voice explanations for AI responses.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSpeechExplanation(!speechExplanation)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                speechExplanation ? 'bg-brand' : 'bg-dark-border'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  speechExplanation ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={() => setIsSettingsOpen(false)}
            className="px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-medium transition-colors shadow-sm cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
