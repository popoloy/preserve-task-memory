[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("help", "init", "checkpoint", "show", "list", "validate", "hook")]
    [string]$Action = "help",
    [string]$SessionId,
    [string]$Root,
    [string]$Objective,
    [string]$DoneCriteria,
    [string]$Current,
    [string[]]$Completed,
    [string[]]$Decision,
    [string[]]$Constraint,
    [string[]]$Next,
    [string[]]$Blocker,
    [string[]]$Evidence,
    [string[]]$File,
    [ValidateSet("active", "blocked", "complete")]
    [string]$Status,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$CapsuleLimit = 6000
$StaleMinutes = 30

function Find-WorkspaceRoot([string]$StartPath) {
    $directory = Get-Item -LiteralPath $StartPath
    if (-not $directory.PSIsContainer) { $directory = $directory.Directory }
    while ($null -ne $directory) {
        $marker = Join-Path $directory.FullName ".agents\skills\preserve-task-memory\SKILL.md"
        if (Test-Path -LiteralPath $marker) { return $directory.FullName }
        $directory = $directory.Parent
    }
    throw "Could not locate the preserve-task-memory skill above '$StartPath'."
}

function Get-SafeSessionId([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "SessionId is required. Use the id supplied by the task-memory hook context."
    }
    $safe = [regex]::Replace($Value.Trim(), "[^A-Za-z0-9._-]", "_")
    if ([string]::IsNullOrWhiteSpace($safe)) { throw "SessionId is invalid." }
    return $safe
}

function Protect-Text([AllowNull()][string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    $result = $Value.Trim()
    $result = [regex]::Replace($result, "(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*", "Bearer <redacted>")
    $secretPattern = "(?i)\b(api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|private[_-]?key)\s*[:=]\s*[^\s,;]+"
    return [regex]::Replace($result, $secretPattern, '$1=<redacted>')
}

function Protect-Items([AllowNull()][object[]]$Values) {
    $result = @()
    foreach ($value in @($Values)) {
        $item = Protect-Text ([string]$value)
        if (-not [string]::IsNullOrWhiteSpace($item)) { $result += $item }
    }
    return @($result)
}

function Merge-Items([AllowNull()][object[]]$Existing, [AllowNull()][object[]]$Added, [int]$Maximum = 100) {
    $seen = @{}
    $result = @()
    foreach ($item in @($Existing) + @(Protect-Items $Added)) {
        $text = [string]$item
        if (-not [string]::IsNullOrWhiteSpace($text) -and -not $seen.ContainsKey($text)) {
            $seen[$text] = $true
            $result += $text
        }
    }
    if ($result.Count -gt $Maximum) { return @($result | Select-Object -Last $Maximum) }
    return @($result)
}

function Write-Utf8([string]$Path, [string]$Content) {
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}

function Write-State([string]$Path, [object]$State) {
    $temporary = "$Path.tmp"
    Write-Utf8 $temporary ($State | ConvertTo-Json -Depth 8)
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Read-State([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Get-Paths([string]$WorkspaceRoot, [string]$Id) {
    $sessionRoot = Join-Path $WorkspaceRoot ".codex\task-memory\sessions\$(Get-SafeSessionId $Id)"
    return @{
        state = Join-Path $sessionRoot "state.json"
        capsule = Join-Path $sessionRoot "capsule.md"
        events = Join-Path $sessionRoot "events.jsonl"
    }
}

function Add-Section([Collections.Generic.List[string]]$Lines, [string]$Heading, [object[]]$Items, [int]$Recent = 0) {
    $values = @($Items | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    if ($Recent -gt 0 -and $values.Count -gt $Recent) { $values = @($values | Select-Object -Last $Recent) }
    if ($values.Count -eq 0) { return }
    $Lines.Add("")
    $Lines.Add("## $Heading")
    foreach ($value in $values) { $Lines.Add("- $value") }
}

function Render-Capsule([object]$State) {
    $lines = New-Object "Collections.Generic.List[string]"
    $lines.Add("# Durable Task Checkpoint")
    $lines.Add("")
    $lines.Add("- Session: $($State.session_id)")
    $lines.Add("- Status: $($State.status)")
    $lines.Add("- Updated: $($State.updated_at)")
    $lines.Add("")
    $lines.Add("## Objective")
    $lines.Add([string]$State.objective)
    if (-not [string]::IsNullOrWhiteSpace([string]$State.done_criteria)) {
        $lines.Add("")
        $lines.Add("## Definition Of Done")
        $lines.Add([string]$State.done_criteria)
    }
    Add-Section $lines "Constraints" @($State.constraints)
    Add-Section $lines "Decisions" @($State.decisions) 12
    Add-Section $lines "Completed" @($State.completed) 8
    if (-not [string]::IsNullOrWhiteSpace([string]$State.current)) {
        $lines.Add("")
        $lines.Add("## Current State")
        $lines.Add([string]$State.current)
    }
    Add-Section $lines "Next Actions" @($State.next_actions) 8
    Add-Section $lines "Blockers" @($State.blockers) 8
    Add-Section $lines "Verification Evidence" @($State.evidence) 8
    Add-Section $lines "Relevant Files" @($State.files) 15
    $capsule = $lines -join [Environment]::NewLine
    if ($capsule.Length -gt $CapsuleLimit) {
        $suffix = "`r`n`r`n[Capsule truncated; inspect state.json for older details.]"
        $capsule = $capsule.Substring(0, $CapsuleLimit - $suffix.Length) + $suffix
    }
    return $capsule
}

function Add-Event([string]$Path, [string]$Kind, [object]$Data) {
    $line = [ordered]@{
        timestamp = [DateTime]::UtcNow.ToString("o")
        kind = $Kind
        data = $Data
    } | ConvertTo-Json -Depth 5 -Compress
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $writer = New-Object IO.StreamWriter($Path, $true, (New-Object Text.UTF8Encoding($false)))
    try { $writer.WriteLine($line) } finally { $writer.Dispose() }
}

function Get-StateErrors([object]$State) {
    $errors = @()
    if ($null -eq $State) { return @("State does not exist.") }
    if ([int]$State.schema_version -ne 1) { $errors += "Unsupported or missing schema_version." }
    if ([string]::IsNullOrWhiteSpace([string]$State.session_id)) { $errors += "session_id is required." }
    if ([string]::IsNullOrWhiteSpace([string]$State.objective)) { $errors += "objective is required." }
    if (@("active", "blocked", "complete") -notcontains [string]$State.status) { $errors += "status is invalid." }
    if ([string]$State.status -eq "complete" -and @($State.blockers).Count -gt 0) {
        $errors += "A complete task cannot retain blockers."
    }
    return @($errors)
}

$hookInput = $null
if ($Action -eq "hook") {
    $rawInput = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($rawInput)) { exit 0 }
    $hookInput = $rawInput | ConvertFrom-Json
}

$startPath = (Get-Location).Path
if ($null -ne $hookInput -and -not [string]::IsNullOrWhiteSpace([string]$hookInput.cwd)) {
    $startPath = [string]$hookInput.cwd
}
$workspaceRoot = if ([string]::IsNullOrWhiteSpace($Root)) {
    Find-WorkspaceRoot $startPath
} else {
    (Resolve-Path -LiteralPath $Root).Path
}

switch ($Action) {
    "init" {
        $paths = Get-Paths $workspaceRoot $SessionId
        if ((Test-Path -LiteralPath $paths.state) -and -not $Force) {
            throw "Task memory already exists for '$SessionId'. Use checkpoint or pass -Force."
        }
        if ([string]::IsNullOrWhiteSpace($Objective)) { throw "Objective is required for init." }
        $now = [DateTime]::UtcNow.ToString("o")
        $initialStatus = if ($PSBoundParameters.ContainsKey("Status")) { $Status } else { "active" }
        $state = [ordered]@{
            schema_version = 1
            session_id = Get-SafeSessionId $SessionId
            objective = Protect-Text $Objective
            done_criteria = Protect-Text $DoneCriteria
            status = $initialStatus
            constraints = @(Protect-Items $Constraint)
            decisions = @()
            completed = @()
            current = $null
            next_actions = @()
            blockers = @()
            evidence = @()
            files = @()
            created_at = $now
            updated_at = $now
            checkpoint_count = 0
        }
        Write-State $paths.state $state
        Write-Utf8 $paths.capsule (Render-Capsule $state)
        Add-Event $paths.events "init" @{ status = $initialStatus }
        Write-Output "Initialized task memory: $($paths.state)"
    }

    "checkpoint" {
        $paths = Get-Paths $workspaceRoot $SessionId
        $state = Read-State $paths.state
        if ($null -eq $state) { throw "No task memory exists for '$SessionId'. Run init first." }

        if (-not [string]::IsNullOrWhiteSpace($Objective)) { $state.objective = Protect-Text $Objective }
        if (-not [string]::IsNullOrWhiteSpace($DoneCriteria)) { $state.done_criteria = Protect-Text $DoneCriteria }
        if (-not [string]::IsNullOrWhiteSpace($Current)) { $state.current = Protect-Text $Current }
        $state.constraints = @(Merge-Items @($state.constraints) $Constraint)
        $state.decisions = @(Merge-Items @($state.decisions) $Decision)
        $state.completed = @(Merge-Items @($state.completed) $Completed)
        $state.evidence = @(Merge-Items @($state.evidence) $Evidence)
        $state.files = @(Merge-Items @($state.files) $File)
        if ($PSBoundParameters.ContainsKey("Next")) { $state.next_actions = @(Protect-Items $Next) }
        if ($PSBoundParameters.ContainsKey("Blocker")) { $state.blockers = @(Protect-Items $Blocker) }
        if ($PSBoundParameters.ContainsKey("Status")) {
            $state.status = $Status
            if ($Status -eq "complete") {
                $state.next_actions = @()
                $state.blockers = @()
            }
        }
        $state.updated_at = [DateTime]::UtcNow.ToString("o")
        $state.checkpoint_count = [int]$state.checkpoint_count + 1

        $errors = @(Get-StateErrors $state)
        if ($errors.Count -gt 0) { throw ($errors -join " ") }
        Write-State $paths.state $state
        Write-Utf8 $paths.capsule (Render-Capsule $state)
        Add-Event $paths.events "checkpoint" @{ status = $state.status; checkpoint_count = $state.checkpoint_count }
        Write-Output "Checkpoint $($state.checkpoint_count) saved: $($paths.state)"
    }

    "show" {
        $paths = Get-Paths $workspaceRoot $SessionId
        $state = Read-State $paths.state
        if ($null -eq $state) { throw "No task memory exists for '$SessionId'." }
        Write-Output (Render-Capsule $state)
    }

    "list" {
        $sessionsRoot = Join-Path $workspaceRoot ".codex\task-memory\sessions"
        $rows = @()
        if (Test-Path -LiteralPath $sessionsRoot) {
            foreach ($stateFile in Get-ChildItem -LiteralPath $sessionsRoot -Filter "state.json" -Recurse -File) {
                $state = Read-State $stateFile.FullName
                if ($null -ne $state) {
                    $rows += [PSCustomObject]@{
                        SessionId = $state.session_id
                        Status = $state.status
                        Updated = $state.updated_at
                        Objective = $state.objective
                    }
                }
            }
        }
        if ($rows.Count -eq 0) { Write-Output "No task-memory sessions found." }
        else { $rows | Sort-Object Updated -Descending | Format-Table -AutoSize }
    }

    "validate" {
        $paths = Get-Paths $workspaceRoot $SessionId
        $state = Read-State $paths.state
        $errors = @(Get-StateErrors $state)
        if ($errors.Count -gt 0) {
            foreach ($message in $errors) { [Console]::Error.WriteLine($message) }
            exit 1
        }
        $capsule = Render-Capsule $state
        if ($capsule.Length -gt $CapsuleLimit) {
            [Console]::Error.WriteLine("Capsule exceeds the character limit.")
            exit 1
        }
        Write-Output "Task memory is valid ($($capsule.Length) capsule characters)."
    }

    "hook" {
        $eventName = [string]$hookInput.hook_event_name
        $hookSessionId = [string]$hookInput.session_id
        if ([string]::IsNullOrWhiteSpace($hookSessionId)) { exit 0 }
        $paths = Get-Paths $workspaceRoot $hookSessionId
        $state = Read-State $paths.state

        if ($eventName -eq "SessionStart") {
            if ($null -eq $state) {
                $context = "Long-task memory is available for session '$hookSessionId'. For multi-stage work, invoke `$preserve-task-memory and initialize a checkpoint with this SessionId."
            } else {
                $errors = @(Get-StateErrors $state)
                if ($errors.Count -gt 0) {
                    $context = "Task memory for session '$hookSessionId' is invalid: $($errors -join ' ') Inspect it before relying on it."
                } else {
                    $context = "Persistent task memory recovered for session '$hookSessionId'. Treat it as a checkpoint, verify it against the workspace, and update it at the next meaningful milestone.`n`n$(Render-Capsule $state)"
                }
            }
            $output = @{ hookSpecificOutput = @{ hookEventName = "SessionStart"; additionalContext = $context } }
            [Console]::Out.WriteLine(($output | ConvertTo-Json -Depth 5 -Compress))
            break
        }

        if ($eventName -eq "PreCompact" -and $null -ne $state) {
            Add-Event $paths.events "precompact" @{ trigger = [string]$hookInput.trigger; checkpoint_count = [int]$state.checkpoint_count }
            $updated = [DateTime]::Parse([string]$state.updated_at).ToUniversalTime()
            $age = ([DateTime]::UtcNow - $updated).TotalMinutes
            if ($age -gt $StaleMinutes) {
                $output = @{
                    continue = $true
                    systemMessage = "Task-memory checkpoint for session '$hookSessionId' is $([math]::Floor($age)) minutes old. Compaction will continue; refresh it at the next milestone."
                }
                [Console]::Out.WriteLine(($output | ConvertTo-Json -Compress))
            }
            break
        }
    }

    default {
        Write-Output @"
preserve-task-memory

Actions:
  init        Create durable state for a session.
  checkpoint  Update changed state and regenerate the capsule.
  show        Print the current capsule.
  list        List known sessions in this workspace.
  validate    Validate state and capsule size.
  hook        Handle Codex lifecycle JSON from stdin.
"@
    }
}
