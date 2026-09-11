param(
	[string]$PackageName = "omp-cursor",
	[int]$NodeValidationMajor = 24
)

$ErrorActionPreference = "Continue"

function Exit-CodeFromLastCommand {
	if ($null -ne $global:LASTEXITCODE) { return [int]$global:LASTEXITCODE }
	if ($?) { return 0 }
	return 1
}

function Write-SectionFile {
	param([string]$Name, [string]$Path)
	Write-Output "--- $Name START ---"
	if (Test-Path -LiteralPath $Path) {
		Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue
	}
	Write-Output "--- $Name END ---"
}

Write-Output "Starting platform-build in $(Get-Location) at $(Get-Date -Format o)"
$SourceRoot = (Get-Location).Path
$RunRoot = Join-Path $SourceRoot (Join-Path ".platform-smoke-runs" ("platform-build-" + (Get-Date -Format "yyyyMMddTHHmmssZ") + "-" + $PID))
$PackDir = Join-Path $RunRoot "pack"
$TestWorkspace = Join-Path $RunRoot "test-workspace"
$PiProject = Join-Path $RunRoot "pi-project"
New-Item -ItemType Directory -Force -Path $PackDir, $TestWorkspace, $PiProject | Out-Null
Write-Output "PLATFORM_RUN_ROOT=$RunRoot"
Write-Output "PLATFORM_TEST_WORKSPACE=$TestWorkspace"
Write-Output "PLATFORM_PI_PROJECT=$PiProject"

$NodeVersion = (& node.exe --version).Trim()
$NpmVersion = (& npm.cmd --version).Trim()
$NodeMajor = [int](($NodeVersion -replace '^v', '').Split('.')[0])
Set-Content -LiteralPath (Join-Path $PackDir "node-version.txt") -Value $NodeVersion
Set-Content -LiteralPath (Join-Path $PackDir "npm-version.txt") -Value $NpmVersion
if ($NodeMajor -ge $NodeValidationMajor) { $NODE_VERSION_EXIT = 0 } else { $NODE_VERSION_EXIT = 1 }
Write-Output "PLATFORM_NODE_VERSION=$NodeVersion"
Write-Output "PLATFORM_NPM_VERSION=$NpmVersion"
Write-Output "PLATFORM_NODE_VERSION_EXIT=$NODE_VERSION_EXIT"
Write-SectionFile "NODE_VERSION_STDOUT" (Join-Path $PackDir "node-version.txt")
Write-SectionFile "NPM_VERSION_STDOUT" (Join-Path $PackDir "npm-version.txt")

$NpmCiOut = Join-Path $PackDir "npm-ci.stdout.txt"
$NpmCiErr = Join-Path $PackDir "npm-ci.stderr.txt"
$CheckPlatformSmokeOut = Join-Path $PackDir "check-platform-smoke.stdout.txt"
$CheckPlatformSmokeErr = Join-Path $PackDir "check-platform-smoke.stderr.txt"
$NpmTestOut = Join-Path $PackDir "npm-test.stdout.txt"
$NpmTestErr = Join-Path $PackDir "npm-test.stderr.txt"
$TypecheckOut = Join-Path $PackDir "typecheck.stdout.txt"
$TypecheckErr = Join-Path $PackDir "typecheck.stderr.txt"
$NpmPackOut = Join-Path $PackDir "npm-pack.stdout.txt"
$NpmPackErr = Join-Path $PackDir "npm-pack.stderr.txt"

Write-Output "=== npm ci ==="
& npm.cmd ci 1> $NpmCiOut 2> $NpmCiErr
$CI_EXIT = Exit-CodeFromLastCommand
Write-Output "PLATFORM_NPM_CI_EXIT=$CI_EXIT"
Write-SectionFile "NPM_CI_STDOUT" $NpmCiOut
Write-SectionFile "NPM_CI_STDERR" $NpmCiErr

Write-Output "=== check:platform-smoke ==="
& npm.cmd run check:platform-smoke -- --testTimeout=15000 1> $CheckPlatformSmokeOut 2> $CheckPlatformSmokeErr
$CHECK_PLATFORM_SMOKE_EXIT = Exit-CodeFromLastCommand
Write-Output "PLATFORM_CHECK_PLATFORM_SMOKE_EXIT=$CHECK_PLATFORM_SMOKE_EXIT"
Write-SectionFile "CHECK_PLATFORM_SMOKE_STDOUT" $CheckPlatformSmokeOut
Write-SectionFile "CHECK_PLATFORM_SMOKE_STDERR" $CheckPlatformSmokeErr

Write-Output "=== npm test ==="
& npm.cmd test -- --testTimeout=15000 1> $NpmTestOut 2> $NpmTestErr
$TEST_EXIT = Exit-CodeFromLastCommand
Write-Output "PLATFORM_NPM_TEST_EXIT=$TEST_EXIT"
Write-SectionFile "NPM_TEST_STDOUT" $NpmTestOut
Write-SectionFile "NPM_TEST_STDERR" $NpmTestErr

Write-Output "=== typecheck ==="
& npm.cmd run typecheck 1> $TypecheckOut 2> $TypecheckErr
$TC_EXIT = Exit-CodeFromLastCommand
Write-Output "PLATFORM_TYPECHECK_EXIT=$TC_EXIT"
Write-SectionFile "TYPECHECK_STDOUT" $TypecheckOut
Write-SectionFile "TYPECHECK_STDERR" $TypecheckErr

Write-Output "=== npm pack ==="
& npm.cmd pack --silent 1> $NpmPackOut 2> $NpmPackErr
$PACK_EXIT = Exit-CodeFromLastCommand
Write-Output "PLATFORM_NPM_PACK_EXIT=$PACK_EXIT"
Write-SectionFile "NPM_PACK_STDOUT" $NpmPackOut
Write-SectionFile "NPM_PACK_STDERR" $NpmPackErr
$PackTarball = (Get-Content -LiteralPath $NpmPackOut -ErrorAction SilentlyContinue | Select-Object -First 1)
if ($PackTarball) { $PackTarball = $PackTarball.Trim() }
Write-Output "PLATFORM_NPM_PACK_EXIT=$PACK_EXIT"
if ($PackTarball -and (Test-Path -LiteralPath $PackTarball)) {
	Move-Item -LiteralPath $PackTarball -Destination (Join-Path $PackDir $PackTarball) -Force
}
Write-Output "PLATFORM_PACKED_TARBALL=$PackTarball"
Set-Content -Path (Join-Path $PackDir "packed-tarball.txt") -Value $PackTarball

Write-Output "=== fixture workspace ==="
Copy-Item -LiteralPath package.json, README.md -Destination $TestWorkspace -ErrorAction SilentlyContinue
Copy-Item -LiteralPath src -Destination $TestWorkspace -Recurse -ErrorAction SilentlyContinue
if ((Test-Path -LiteralPath (Join-Path $TestWorkspace "package.json")) -and (Test-Path -LiteralPath (Join-Path $TestWorkspace "README.md")) -and (Test-Path -LiteralPath (Join-Path $TestWorkspace "src"))) {
	$FIXTURE_EXIT = 0
} else {
	$FIXTURE_EXIT = 1
}
Write-Output "PLATFORM_FIXTURE_EXIT=$FIXTURE_EXIT"

$OmpCli = Join-Path (Get-Location) "node_modules\.bin\omp.cmd"
if (-not (Test-Path -LiteralPath $OmpCli)) { $OmpCli = Join-Path (Get-Location) "node_modules\.bin\omp" }
if (-not (Test-Path -LiteralPath $OmpCli)) {
	$Command = Get-Command omp -ErrorAction SilentlyContinue
	$OmpCli = $Command.Source
}
Write-Output "PLATFORM_OMP_CLI=$OmpCli"

$PackedNodeInstallOut = Join-Path $PackDir "packed-node-install.stdout.txt"
$PackedNodeInstallErr = Join-Path $PackDir "packed-node-install.stderr.txt"
$OmpInstallOut = Join-Path $PackDir "omp-install.stdout.txt"
$OmpInstallErr = Join-Path $PackDir "omp-install.stderr.txt"
$OmpListOut = Join-Path $PackDir "omp-list.stdout.txt"
$OmpListErr = Join-Path $PackDir "omp-list.stderr.txt"

Write-Output "=== omp install packed tarball ==="
$TarballPath = Join-Path $PackDir $PackTarball
if ($PackTarball -and $OmpCli -and (Test-Path -LiteralPath $TarballPath)) {
	Push-Location $PiProject
	& npm.cmd init -y 1> $PackedNodeInstallOut 2> $PackedNodeInstallErr
	$NPM_INIT_EXIT = Exit-CodeFromLastCommand
	if ($NPM_INIT_EXIT -eq 0) {
		& npm.cmd install --no-save $TarballPath 1>> $PackedNodeInstallOut 2>> $PackedNodeInstallErr
		$PACKED_NODE_INSTALL_EXIT = Exit-CodeFromLastCommand
	} else {
		$PACKED_NODE_INSTALL_EXIT = $NPM_INIT_EXIT
	}
	if ($PACKED_NODE_INSTALL_EXIT -eq 0) {
		$PreviousOmpOffline = $env:PI_OFFLINE
		$env:PI_OFFLINE = "1"
		& $OmpCli plugin install --local (Join-Path ".\node_modules" $PackageName) 1> $OmpInstallOut 2> $OmpInstallErr
		$OMP_INSTALL_EXIT = Exit-CodeFromLastCommand
		if ($null -eq $PreviousOmpOffline) { Remove-Item Env:\PI_OFFLINE -ErrorAction SilentlyContinue } else { $env:PI_OFFLINE = $PreviousOmpOffline }
	} else {
		Set-Content -LiteralPath $OmpInstallErr -Value "packed npm install failed"
		$OMP_INSTALL_EXIT = 1
	}
	Pop-Location
} else {
	Set-Content -LiteralPath $PackedNodeInstallErr -Value "missing omp cli or tarball"
	Set-Content -LiteralPath $OmpInstallErr -Value "missing omp cli or tarball"
	$PACKED_NODE_INSTALL_EXIT = 1
	$OMP_INSTALL_EXIT = 1
}
Write-Output "PLATFORM_PACKED_NODE_INSTALL_EXIT=$PACKED_NODE_INSTALL_EXIT"
Write-SectionFile "PACKED_NODE_INSTALL_STDOUT" $PackedNodeInstallOut
Write-SectionFile "PACKED_NODE_INSTALL_STDERR" $PackedNodeInstallErr
Write-Output "PLATFORM_OMP_INSTALL_EXIT=$OMP_INSTALL_EXIT"
Write-SectionFile "OMP_INSTALL_STDOUT" $OmpInstallOut
Write-SectionFile "OMP_INSTALL_STDERR" $OmpInstallErr

Write-Output "=== omp plugin list ==="
if ($OmpCli) {
	Push-Location $PiProject
	$PreviousOmpOffline = $env:PI_OFFLINE
	$env:PI_OFFLINE = "1"
	& $OmpCli plugin list --json 1> $OmpListOut 2> $OmpListErr
	$OMP_LIST_EXIT = Exit-CodeFromLastCommand
	if ($null -eq $PreviousOmpOffline) { Remove-Item Env:\PI_OFFLINE -ErrorAction SilentlyContinue } else { $env:PI_OFFLINE = $PreviousOmpOffline }
	Pop-Location
} else {
	Set-Content -LiteralPath $OmpListErr -Value "missing omp cli"
	$OMP_LIST_EXIT = 1
}
Write-Output "PLATFORM_OMP_LIST_EXIT=$OMP_LIST_EXIT"
Write-SectionFile "OMP_LIST_STDOUT" $OmpListOut
Write-SectionFile "OMP_LIST_STDERR" $OmpListErr

Write-Output "node=$NODE_VERSION_EXIT ci=$CI_EXIT checkPlatformSmoke=$CHECK_PLATFORM_SMOKE_EXIT test=$TEST_EXIT typecheck=$TC_EXIT pack=$PACK_EXIT fixture=$FIXTURE_EXIT packedNodeInstall=$PACKED_NODE_INSTALL_EXIT install=$OMP_INSTALL_EXIT list=$OMP_LIST_EXIT"
if ($NODE_VERSION_EXIT -ne 0 -or $CI_EXIT -ne 0 -or $CHECK_PLATFORM_SMOKE_EXIT -ne 0 -or $TEST_EXIT -ne 0 -or $TC_EXIT -ne 0 -or $PACK_EXIT -ne 0 -or $FIXTURE_EXIT -ne 0 -or $PACKED_NODE_INSTALL_EXIT -ne 0 -or $OMP_INSTALL_EXIT -ne 0 -or $OMP_LIST_EXIT -ne 0) {
	Write-Output "PLATFORM_BUILD_FAILED: node=$NODE_VERSION_EXIT ci=$CI_EXIT checkPlatformSmoke=$CHECK_PLATFORM_SMOKE_EXIT test=$TEST_EXIT typecheck=$TC_EXIT pack=$PACK_EXIT fixture=$FIXTURE_EXIT packedNodeInstall=$PACKED_NODE_INSTALL_EXIT install=$OMP_INSTALL_EXIT list=$OMP_LIST_EXIT"
	exit 1
}
Write-Output "PLATFORM_BUILD_OK"
