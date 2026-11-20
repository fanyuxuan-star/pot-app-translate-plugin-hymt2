' Start Pot x Hy-MT2 local relay (hidden window)
Option Explicit

Dim fso, shell, baseDir, scriptPath, nodePath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
scriptPath = fso.BuildPath(baseDir, "relay-hymt2.js")

nodePath = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(nodePath) Then
    nodePath = "node.exe"
End If

shell.CurrentDirectory = baseDir
shell.Run """" & nodePath & """ """ & scriptPath & """", 0, False
