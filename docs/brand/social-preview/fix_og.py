import sys
from PIL import Image
src, out_png, out_jpg = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(src).convert("RGB")
px = im.load()
W, H = im.size
C = (251, 245, 238)  # canvas cream measured outside the logo box

def dist(p):
    return abs(p[0]-C[0]) + abs(p[1]-C[1]) + abs(p[2]-C[2])

# 1) Dissolve the darker rectangle behind the logo: only near-cream background
#    pixels are moved to the canvas colour; logo/text pixels (gold, maroon) are far
#    outside the tolerance and are untouched. A soft band blends anti-aliased edges.
X0, X1, Y0, Y1 = 360, 845, 0, 470
LO, HI = 26, 52
changed = 0
for y in range(Y0, Y1):
    for x in range(X0, X1):
        p = px[x, y]
        d = dist(p)
        if d <= LO:
            px[x, y] = C; changed += 1
        elif d < HI:
            t = (d - LO) / (HI - LO)
            px[x, y] = tuple(round(C[i]*(1-t) + p[i]*t) for i in range(3)); changed += 1

# 2) Remove the stray "EST' " prefix; "BANGLADESH" stays, already right-aligned.
for y in range(58, 88):
    for x in range(944, 987):
        px[x, y] = C

im.save(out_png, optimize=True)
im.save(out_jpg, "JPEG", quality=88, optimize=True, progressive=True, subsampling="4:4:4")
print("pixels adjusted:", changed)
