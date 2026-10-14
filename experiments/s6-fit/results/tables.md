### NIST StRD without bounds (27 problems x 2 starts = 54 runs)

| candidate | derivatives | solved (LRE >= 4) | median LRE params | median LRE errors | median LRE library errors | median LRE rss | iterations | nfev | not solved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| lm | analytic | 53/54 | 8.9 | 8.8 | - | 11.0 | 3111 | 3544 | BoxBOD/1 |
| lm | forward | 53/54 | 7.6 | 6.7 | - | 11.0 | 3118 | 16406 | BoxBOD/1 |
| lm-bounded | analytic | 53/54 | 8.9 | 8.8 | - | 11.0 | 3111 | 3544 | BoxBOD/1 |
| lm-bounded | forward | 53/54 | 7.6 | 6.7 | - | 11.0 | 3118 | 16406 | BoxBOD/1 |
| cmpfit | analytic | 53/54 | 8.9 | 8.8 | 8.4 | 11.0 | 3128 | 6664 | BoxBOD/1 |
| cmpfit | forward | 53/54 | 7.9 | 6.7 | 6.8 | 11.0 | 3157 | 16548 | BoxBOD/1 |
| rmpfit | analytic | 53/54 | 9.3 | 8.9 | 8.6 | 11.0 | 3369 | 7409 | BoxBOD/1 |
| rmpfit | forward | 53/54 | 7.8 | 6.8 | 6.8 | 11.0 | 3393 | 17677 | BoxBOD/1 |

### NIST StRD in a loose box (bounds hold both starts and the certified value; none is active at the solution)

| candidate | derivatives | solved (LRE >= 4) | median LRE params | median LRE errors | median LRE library errors | median LRE rss | iterations | nfev | not solved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| lm-transform | analytic | 51/54 | 9.2 | 9.1 | 9.1 | 11.0 | 2592 | 3047 | Lanczos3/1, MGH17/1, MGH10/1 |
| lm-transform | forward | 50/54 | 7.1 | 6.8 | 5.6 | 11.0 | 2606 | 13923 | Lanczos3/1, MGH17/1, MGH09/1, MGH10/1 |
| lm-bounded | analytic | 53/54 | 8.7 | 8.8 | - | 11.0 | 3717 | 4195 | MGH10/1 |
| lm-bounded | forward | 53/54 | 7.7 | 6.8 | - | 11.0 | 3688 | 18458 | MGH10/1 |
| cmpfit | analytic | 53/54 | 8.9 | 8.8 | 8.3 | 11.0 | 3734 | 7887 | MGH10/1 |
| cmpfit | forward | 53/54 | 8.0 | 6.8 | 6.9 | 11.0 | 3734 | 18618 | MGH10/1 |
| rmpfit | analytic | 53/54 | 9.3 | 8.8 | 8.4 | 11.0 | 3903 | 8578 | MGH10/1 |
| rmpfit | forward | 53/54 | 8.0 | 6.8 | 6.8 | 11.0 | 4126 | 20959 | MGH10/1 |

Medians are over the solved runs. LRE: the number of correct significant digits (at most 11, the digits of the certified values). "errors": from the Jacobian at the solution, computed the same way for all candidates. "library errors": as the library gives them (cmpfit and rmpfit: their covariance; lm-transform: the lmfit-style mapping), scaled by sqrt(rss/dof). iterations and nfev are sums over the runs. nfev counts every evaluation of the residual vector, including those for forward differences.

### NIST StRD per problem: smallest LRE of the parameters (start 1 / start 2), no bounds

| problem | level | lm A | lm F | cmpfit A | cmpfit F | rmpfit A | rmpfit F |
|---|---:|---:|---:|---:|---:|---:|---:|
| Misra1a | lower | 9.8 / 10.3 | 8.4 / 9.3 | 9.8 / 10.3 | 9.7 / 8.4 | 8.9 / 10.2 | 9.0 / 9.3 |
| Chwirut2 | lower | 8.9 / 8.6 | 7.4 / 7.4 | 8.9 / 8.6 | 8.2 / 7.9 | 7.5 / 8.6 | 8.0 / 7.4 |
| Chwirut1 | lower | 8.5 / 8.5 | 7.8 / 7.6 | 8.5 / 8.5 | 7.5 / 8.0 | 8.5 / 8.5 | 8.2 / 7.6 |
| Lanczos3 | lower | 10.5 / 6.4 | 5.5 / 6.0 | 10.5 / 6.4 | 7.1 / 5.7 | 8.7 / 6.4 | 5.7 / 6.0 |
| Gauss1 | lower | 10.6 / 8.6 | 9.4 / 8.7 | 10.6 / 8.6 | 9.0 / 9.4 | 10.6 / 8.6 | 9.4 / 8.7 |
| Gauss2 | lower | 10.0 / 9.9 | 9.2 / 9.2 | 10.0 / 9.9 | 9.2 / 9.2 | 10.0 / 9.9 | 9.2 / 9.2 |
| DanWood | lower | 10.0 / 11.0 | 9.6 / 9.8 | 10.0 / 11.0 | 8.9 / 9.0 | 10.0 / 11.0 | 9.6 / 9.8 |
| Misra1b | lower | 10.9 / 9.3 | 7.9 / 8.3 | 10.9 / 9.3 | 8.2 / 8.3 | 10.9 / 9.3 | 8.5 / 8.3 |
| Kirby2 | average | 8.5 / 8.0 | 7.3 / 7.6 | 8.5 / 8.0 | 7.1 / 7.8 | 8.5 / 8.0 | 7.3 / 7.7 |
| Hahn1 | average | 7.5 / 9.8 | 6.4 / 6.6 | 7.5 / 9.8 | 6.4 / 6.0 | 8.1 / 9.8 | 6.2 / 6.6 |
| Nelson | average | 7.9 / 8.3 | 6.9 / 6.3 | 7.9 / 8.3 | 6.3 / 6.7 | 7.7 / 9.9 | 7.1 / 7.5 |
| MGH17 | average | 9.6 / 8.1 | 6.9 / 6.2 | 9.6 / 8.1 | 7.1 / 8.7 | 9.6 / 8.1 | 7.7 / 7.5 |
| Lanczos1 | average | 10.6 / 10.6 | 10.6 / 10.6 | 10.6 / 10.6 | 10.6 / 10.6 | 10.6 / 10.6 | 10.6 / 10.6 |
| Lanczos2 | average | 8.4 / 10.4 | 7.0 / 6.1 | 8.4 / 10.4 | 6.3 / 6.0 | 10.4 / 10.4 | 5.6 / 6.1 |
| Gauss3 | average | 9.2 / 9.5 | 8.6 / 8.9 | 9.2 / 9.5 | 8.5 / 8.9 | 9.2 / 9.5 | 8.6 / 8.9 |
| Misra1c | average | 8.3 / 10.1 | 9.2 / 8.2 | 8.3 / 10.1 | 8.5 / 8.1 | 10.6 / 10.1 | 8.7 / 8.2 |
| Misra1d | average | 8.7 / 11.0 | 9.1 / 8.9 | 8.7 / 11.0 | 10.5 / 8.8 | 11.0 / 11.0 | 8.5 / 8.9 |
| Roszman1 | average | 7.0 / 7.1 | 6.7 / 7.6 | 7.0 / 7.1 | 6.0 / 7.2 | 7.0 / 7.1 | 6.7 / 7.6 |
| ENSO | average | 6.3 / 6.3 | 6.3 / 6.2 | 6.3 / 6.3 | 6.7 / 6.1 | 6.3 / 6.3 | 6.4 / 6.2 |
| MGH09 | higher | 7.1 / 7.2 | 7.2 / 7.0 | 7.1 / 7.2 | 6.6 / 7.8 | 7.6 / 7.1 | 6.5 / 6.7 |
| Thurber | higher | 7.6 / 8.1 | 7.5 / 7.4 | 7.6 / 8.1 | 7.9 / 7.6 | 7.5 / 8.1 | 7.1 / 7.4 |
| BoxBOD | higher | 0.0 / 8.5 | 0.0 / 8.8 | 0.0 / 8.5 | 0.0 / 8.9 | 0.0 / 8.5 | 0.0 / 8.8 |
| Rat42 | higher | 10.4 / 8.3 | 9.6 / 9.6 | 10.4 / 8.3 | 8.6 / 8.4 | 10.4 / 8.3 | 9.1 / 9.6 |
| MGH10 | higher | 10.9 / 9.0 | 6.5 / 6.9 | 10.9 / 9.0 | 7.7 / 7.8 | 10.9 / 10.9 | 6.5 / 7.4 |
| Eckerle4 | higher | 9.7 / 9.6 | 9.6 / 9.7 | 9.7 / 9.6 | 9.6 / 9.2 | 10.5 / 9.6 | 8.9 / 9.7 |
| Rat43 | higher | 8.0 / 8.4 | 7.2 / 8.1 | 8.0 / 8.4 | 7.0 / 7.3 | 8.4 / 8.4 | 7.8 / 8.1 |
| Bennett5 | higher | 11.0 / 11.0 | 5.9 / 6.0 | 11.0 / 11.0 | 5.6 / 6.4 | 10.0 / 9.5 | 6.8 / 6.0 |

A: analytic derivatives. F: forward differences. lm-bounded without bounds gives the same bits as lm.

### Bounds that are active at the solution

| case | candidate | LRE params | LRE errors (free) | LRE library errors (free) | iterations / nfev | parameters | errors (library, else common) |
|---|---:|---:|---:|---:|---:|---:|---:|
| **expdecay tau<=1.5** | reference (active: b3=1.5) |  |  |  |  | 0.61821400, 3.1888058, 1.5000000 | 0.00826, 0.0297, 0.00 |
|  | lm-transform A | 9.4 | 15.0 | 0.5 | 14 / 26 | 0.61821400, 3.1888058, 1.5000000 | 0.0108, 0.0347, 0.0305 |
|  | lm-transform F | 9.8 | 8.4 | 0.0 | 10 / 46 | 0.61821400, 3.1888058, 1.5000000 | NaN, NaN, NaN |
|  | lm-bounded A | 14.8 | 15.0 | - | 3 / 3 | 0.61821400, 3.1888058, 1.5000000 | 0.00826, 0.0297, 0.00 |
|  | lm-bounded F | 9.5 | 8.4 | - | 3 / 13 | 0.61821400, 3.1888058, 1.5000000 | 0.00826, 0.0297, 0.00 |
|  | cmpfit A | 14.8 | 15.0 | 15.0 | 3 / 6 | 0.61821400, 3.1888058, 1.5000000 | 0.00826, 0.0297, 0.00 |
|  | cmpfit F | 8.7 | 8.4 | 8.4 | 3 / 13 | 0.61821400, 3.1888058, 1.5000000 | 0.00826, 0.0297, 0.00 |
|  | rmpfit A | 14.8 | 15.0 | 15.0 | 3 / 6 | 0.61821400, 3.1888058, 1.5000000 | 0.00826, 0.0297, 0.00 |
|  | rmpfit F | 9.5 | 8.4 | 8.3 | 4 / 13 | 0.61821400, 3.1888058, 1.5000000 | 0.00826, 0.0297, 0.00 |
| **gauss w>=0.1** | reference (active: b4=0.1) |  |  |  |  | 0.087795271, 1.2796861, 0.10011454, 0.10000000 | 0.00580, 0.0328, 0.00248, 0.00 |
|  | lm-transform A | 7.9 | 11.4 | 0.7 | 23 / 38 | 0.087795271, 1.2796861, 0.10011454, 0.10000000 | 0.00590, 0.0391, 0.00248, 0.00357 |
|  | lm-transform F | 7.9 | 0.7 | 0.0 | 29 / 149 | 0.087795272, 1.2796861, 0.10011454, 0.10000000 | NaN, NaN, NaN, NaN |
|  | lm-bounded A | 7.6 | 15.0 | - | 34 / 35 | 0.087795271, 1.2796861, 0.10011454, 0.10000000 | 0.00580, 0.0328, 0.00248, 0.00 |
|  | lm-bounded F | 7.6 | 8.5 | - | 34 / 171 | 0.087795270, 1.2796861, 0.10011454, 0.10000000 | 0.00580, 0.0328, 0.00248, 0.00 |
|  | cmpfit A | 7.6 | 15.0 | 15.0 | 35 / 69 | 0.087795271, 1.2796861, 0.10011454, 0.10000000 | 0.00580, 0.0328, 0.00248, 0.00 |
|  | cmpfit F | 7.6 | 8.8 | 8.3 | 35 / 171 | 0.087795272, 1.2796861, 0.10011454, 0.10000000 | 0.00580, 0.0328, 0.00248, 0.00 |
|  | rmpfit A | 0.0 | 0.0 | 0.0 | 11 / 23 | 0.0000000, 0.62742902, 0.0000000, 0.24216225 | 0.00, 0.0507, 0.00, 0.0226 |
|  | rmpfit F | 0.0 | 0.0 | 0.0 | 11 / 51 | 0.0000000, 0.62742902, 0.0000000, 0.24216224 | 0.00, 0.0507, 0.00, 0.0226 |
| **gauss x0<=0.05 w>=0.1** | reference (active: b3=0.05) |  |  |  |  | 0.097630917, 1.0179224, 0.050000000, 0.10385511 | 0.00900, 0.0585, 0.00, 0.00697 |
|  | lm-transform A | 6.8 | 6.8 | 6.8 | 180 / 209 | 0.097630913, 1.0179223, 0.050000000, 0.10385513 | 0.00900, 0.0585, 0.00484, 0.00697 |
|  | lm-transform F | 7.9 | 2.9 | 0.0 | 35 / 182 | 0.097630917, 1.0179224, 0.050000000, 0.10385511 | NaN, NaN, NaN, NaN |
|  | lm-bounded A | 7.9 | 7.9 | - | 19 / 20 | 0.097630917, 1.0179224, 0.050000000, 0.10385511 | 0.00900, 0.0585, 0.00, 0.00697 |
|  | lm-bounded F | 7.8 | 7.9 | - | 19 / 96 | 0.097630917, 1.0179224, 0.050000000, 0.10385511 | 0.00900, 0.0585, 0.00, 0.00697 |
|  | cmpfit A | 7.9 | 7.9 | 7.2 | 20 / 39 | 0.097630917, 1.0179224, 0.050000000, 0.10385511 | 0.00900, 0.0585, 0.00, 0.00697 |
|  | cmpfit F | 8.0 | 8.2 | 7.2 | 20 / 96 | 0.097630917, 1.0179224, 0.050000000, 0.10385511 | 0.00900, 0.0585, 0.00, 0.00697 |
|  | rmpfit A | 0.0 | 0.8 | 0.0 | 9 / 19 | 0.0000000, 1.0985374, 0.050000000, 0.11573445 | 0.00, 0.0627, 0.00, 0.00763 |
|  | rmpfit F | 0.0 | 0.8 | 0.0 | 10 / 51 | 0.0000000, 1.0985374, 0.050000000, 0.11573445 | 0.00, 0.0627, 0.00, 0.00763 |
| **Misra1a start1 b1>=300** | reference (active: b1=300.0) |  |  |  |  | 300.00000, 0.00042401875 | 0.00, 0.00000132 |
|  | lm-transform A | 9.4 | 10.0 | 0.0 | 28 / 51 | 300.00000, 0.00042401875 | 22.2, 0.0000353 |
|  | lm-transform F | 9.0 | 7.9 | 0.0 | 21 / 76 | 300.00000, 0.00042401875 | NaN, NaN |
|  | lm-bounded A | 9.4 | 10.1 | - | 15 / 18 | 300.00000, 0.00042401875 | 0.00, 0.00000132 |
|  | lm-bounded F | 9.4 | 8.2 | - | 15 / 52 | 300.00000, 0.00042401875 | 0.00, 0.00000132 |
|  | cmpfit A | 9.4 | 10.1 | 10.1 | 28 / 65 | 300.00000, 0.00042401875 | 0.00, 0.00000132 |
|  | cmpfit F | 9.3 | 8.7 | 11.7 | 26 / 91 | 300.00000, 0.00042401875 | 0.00, 0.00000132 |
|  | rmpfit A | 9.0 | 9.7 | 9.7 | 25 / 64 | 300.00000, 0.00042401875 | 0.00, 0.00000132 |
|  | rmpfit F | 9.0 | 8.5 | 8.5 | 25 / 85 | 300.00000, 0.00042401875 | 0.00, 0.00000132 |
| **BoxBOD start2 b2>=0.65** | reference (active: b2=0.65) |  |  |  |  | 206.29215, 0.65000000 | 7.83, 0.00 |
|  | lm-transform A | 8.6 | 15.0 | 0.4 | 15 / 30 | 206.29216, 0.65000000 | 10.8, 0.123 |
|  | lm-transform F | 8.5 | 0.3 | 0.0 | 8 / 28 | 206.29215, 0.65000000 | NaN, NaN |
|  | lm-bounded A | 15.0 | 15.0 | - | 6 / 6 | 206.29215, 0.65000000 | 7.83, 0.00 |
|  | lm-bounded F | 10.4 | 9.6 | - | 8 / 25 | 206.29215, 0.65000000 | 7.83, 0.00 |
|  | cmpfit A | 15.0 | 15.0 | 15.0 | 6 / 12 | 206.29215, 0.65000000 | 7.83, 0.00 |
|  | cmpfit F | 10.0 | 8.7 | 8.6 | 6 / 19 | 206.29215, 0.65000000 | 7.83, 0.00 |
|  | rmpfit A | 15.0 | 15.0 | 15.0 | 6 / 12 | 206.29215, 0.65000000 | 7.83, 0.00 |
|  | rmpfit F | 10.4 | 9.6 | 9.6 | 8 / 25 | 206.29215, 0.65000000 | 7.83, 0.00 |

The reference fixes the active parameters at their bounds and fits the others without bounds (A0, analytic). LRE is against the reference, at most 15. "errors (free)" leaves out the parameters at a bound.

### Other numbers

| candidates | derivatives | runs with the same parameter bits (NIST, no bounds) |
|---|---:|---:|
| lm and lm-bounded | analytic | 54/54 |
| lm and lm-bounded | forward | 54/54 |
| lm and cmpfit | analytic | 52/54 |
| lm and cmpfit | forward | 0/54 |
| lm and rmpfit | analytic | 26/54 |
| lm and rmpfit | forward | 22/54 |
| cmpfit and rmpfit | analytic | 26/54 |
| cmpfit and rmpfit | forward | 0/54 |

| candidate | smallest parameter LRE of a solved run (no bounds) | run |
|---|---:|---:|
| lm analytic | 6.25 | ENSO/1 |
| lm forward | 5.48 | Lanczos3/1 |
| lm-bounded analytic | 6.25 | ENSO/1 |
| lm-bounded forward | 5.48 | Lanczos3/1 |
| cmpfit analytic | 6.25 | ENSO/1 |
| cmpfit forward | 5.58 | Bennett5/1 |
| rmpfit analytic | 6.25 | ENSO/1 |
| rmpfit forward | 5.61 | Lanczos2/1 |

Lanczos1: the smallest LRE of the standard errors is 2.9 to 4.1 over all candidates, starts, and derivatives. Its certified rss is 1.4e-25.

MGH10 from start 1 in the loose box (`s6cli mgh10`, analytic derivatives):

| candidate | bounds | maxiter | iterations | status | smallest LRE |
|---|---:|---:|---:|---:|---:|
| lm-transform | loose box | 1000 | 184 | Converged(xtol) | 0.0 |
| lm-bounded | loose box | 1000 | 1000 | MaxIter | 0.0 |
| cmpfit | loose box | 1000 | 1000 | MAXITER | 0.0 |
| rmpfit | loose box | 1000 | 1000 | MaxIter | 0.0 |
| lm-transform | loose box | 20000 | 184 | Converged(xtol) | 0.0 |
| lm-bounded | loose box | 20000 | 6785 | Converged(xtol) | 10.9 |
| cmpfit | loose box | 20000 | 6844 | OK_PAR | 9.4 |
| rmpfit | loose box | 20000 | 6892 | Par | 9.4 |
| lm | no bounds | 20000 | 253 | Converged(xtol) | 10.9 |
