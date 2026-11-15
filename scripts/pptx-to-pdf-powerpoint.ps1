# Open a PPTX in Microsoft PowerPoint (read-only, no window) and export it to PDF.
# Proves PowerPoint can open the file without repair; prints slide count. Never closes the user's other presentations.
param([Parameter(Mandatory = $true)][string]$In, [Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
$ppt = $null; $pres = $null
try {
  $ppt = New-Object -ComObject PowerPoint.Application
  # Open(FileName, ReadOnly, Untitled, WithWindow)
  $pres = $ppt.Presentations.Open((Resolve-Path $In).Path, -1, 0, 0)
  $count = $pres.Slides.Count
  $w = $pres.PageSetup.SlideWidth; $h = $pres.PageSetup.SlideHeight
  $pres.SaveAs([System.IO.Path]::GetFullPath($Out), 32)   # 32 = ppSaveAsPDF
  Write-Output ("OK slides={0} size={1}x{2}pt" -f $count, $w, $h)
} catch {
  Write-Output ("FAIL " + $_.Exception.Message)
  exit 1
} finally {
  if ($pres) { $pres.Close() }
  if ($ppt -and $ppt.Presentations.Count -eq 0) { $ppt.Quit() }
  if ($ppt) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) }
}
