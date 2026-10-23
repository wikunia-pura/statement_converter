/**
 * ZUS's certificates the przesyłki are encrypted to — public keys ZUS publishes for interface software:
 *  • production: PE-2-ZUS-EWD, serial 77798805994D053DD0D2952DBCAFDF99, valid 2025-12-03 – 2027-12-03
 *    (www.zus.pl/bip/pliki/PE-2-ZUS-EWD.pem; the serial is the one ZUS's notice of the change names);
 *  • test (pt2.zus.pl): PE-2-ZUS-PT, serial 05D8AB379408F37C13509EAC2C1F1591, valid 2025-12-09 – 2027-12-09
 *    (bip.zus.pl → Wymagania dla oprogramowania interfejsowego → "Certyfikat klucza publicznego makiety testowej").
 * ZUS replaces them about every two years and announces it weeks ahead; the new one goes here, and an expired
 * one stops the send with a message saying where to look rather than sending something ZUS cannot open.
 */

import { X509Certificate } from 'crypto';
import { ZusSrodowisko } from '../../shared/zus-ewd';
import { AppError } from '../../shared/app-errors';

/** The certificates' DER as base64 (the PEM bodies). */
const PEM: Record<ZusSrodowisko, string> = {
  prod: `
    MIIGXDCCBESgAwIBAgIQd3mIBZlNBT3Q0pUtvK/fmTANBgkqhkiG9w0BAQsFADBOMQswCQYDVQQG
    EwJQTDEhMB8GA1UECgwYQXNzZWNvIERhdGEgU3lzdGVtcyBTLkEuMRwwGgYDVQQDDBNDZXJ0dW0g
    U01JTUUgUlNBIENBMB4XDTI1MTIwMzA1NDc1OFoXDTI3MTIwMzA1NDc1N1owgcsxGTAXBgNVBGET
    EFZBVFBMLTUyMTMwMTcyMjgxCzAJBgNVBAYTAlBMMRQwEgYDVQQIDAttYXpvd2llY2tpZTERMA8G
    A1UEBwwIV2Fyc3phd2ExKjAoBgNVBAoMIVpha8WCYWQgVWJlenBpZWN6ZcWEIFNwb8WCZWN6bnlj
    aDEqMCgGA1UEAwwhWmFrxYJhZCBVYmV6cGllY3plxYQgU3BvxYJlY3pueWNoMSAwHgYJKoZIhvcN
    AQkBFhFzZXJ3aXNfRVdEQHp1cy5wbDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAL5G
    oIUOrn+f1SMWMlsWFxQEvmwbBJ8VAFxMP+rVhXzUHk8qQb3pwQ4YdWJVX3HOhbCTOhUzPe8L7r/P
    LO+puCPftnTqZHY75U0CH6FjlNpryDvOfwLIN3EAGfz8QhZbcQTqPocUlFAqSq55/kvg64jj1GKf
    1fzOQaUduk+rdl3TsuFbF5rizIV/AfXtCkaXNnMoeL73a1GumFE+Uj/xVA1K+0TVbrg2lYPqICNg
    Rw9SY5OWsUv7F5KB9mI4crykNqXsZYXsM0R2zUYGlUQBoeAzBJ7IYonkTegU3c7acv1TJokLQIrr
    vlP2T7JhmeBYZ/oIN/41oyM3iMkSo6lR4aECAwEAAaOCAbYwggGyMAwGA1UdEwEB/wQCMAAwQQYD
    VR0fBDowODA2oDSgMoYwaHR0cDovL2NzbWltZXJzYWNhLmNybC5jZXJ0dW0ucGwvY3NtaW1lcnNh
    Y2EuY3JsMIGDBggrBgEFBQcBAQR3MHUwLgYIKwYBBQUHMAGGImh0dHA6Ly9jc21pbWVyc2FjYS5v
    Y3NwLWNlcnR1bS5jb20wQwYIKwYBBQUHMAKGN2h0dHA6Ly9jc21pbWVyc2FjYS5yZXBvc2l0b3J5
    LmNlcnR1bS5wbC9jc21pbWVyc2FjYS5jZXIwHwYDVR0jBBgwFoAUZvvDD770v+CcyatN3kcZvcDK
    pmgwHQYDVR0OBBYEFBXwSnD2VQo/3DYkv5F0PPtGX0tbMEwGA1UdIARFMEMwCQYHZ4EMAQUCAjA2
    BgsqhGgBhvZ3AmQDATAnMCUGCCsGAQUFBwIBFhlodHRwczovL3d3dy5jZXJ0dW0ucGwvQ1BTMB0G
    A1UdJQQWMBQGCCsGAQUFBwMEBggrBgEFBQcDAjAOBgNVHQ8BAf8EBAMCBPAwHAYDVR0RBBUwE4ER
    c2Vyd2lzX0VXREB6dXMucGwwDQYJKoZIhvcNAQELBQADggIBABdckIy0LBXe/pTliN6Qosg1Tzq1
    2kQ++F3zwr9D9KD6KnlAnYWD/b4qTQXVj21/50o4l7Q+7fphptW7rczJGNF5vwsdU6AeVMCfz0YI
    DBuBrvs9cKo4BX2fgwJQV4zODnQ+ovPsBNmTj0dYN661AqJui5/dNMPIpW3h2hbOLdI3e4M+4Hmh
    Bwn12u8kqy6Q51tPgAuaxoDis/1MGZtPkQkgDEu6ydqNTByw8cDX5Ow33IbE5VIcu6V6W9nUnecw
    nxm7iaObgX7yNbnkALe+G89bObUTeyUxqqjpu8PfAH7og4PvhN/20OPlSNSO8FKbjCHDwE9Y481K
    gNR2xxafWCXj6e1AhxB8bIl1IdX87tvQQgkQBwjpXyOlBjfdhfFFRXEcE7Y2bPC5iPSB/3CRcwyP
    JVSK2QTJxvkwOtlp2QXysVuWqqd6oKlH5RhiJcm1b78Zjn0nZrOz1+FUpjoX7TeYy7d4Y9LFTaSm
    ZKfHFWx2dvqGHsQ9DzD8jzBX1PhoS3uZz+oCqxhUyw3ZEtWSuV2pw7JX7b6tkbHbKp5+7+2rJ4A6
    60nE308l0oWRDl0A1j17bysOVlb0CNnWtBoOq2EzGMM5bM9+v4x3yVTuFXXpLIt7v1zJKMJS0DJQ
    KzAZLokTO8IyUJ4BYK8tGbjln30bTs/AHUlO4o55CE0P8Vh6`,
  test: `
    MIIGXDCCBESgAwIBAgIQBdirN5QI83wTUJ6sLB8VkTANBgkqhkiG9w0BAQsFADBOMQswCQYDVQQG
    EwJQTDEhMB8GA1UECgwYQXNzZWNvIERhdGEgU3lzdGVtcyBTLkEuMRwwGgYDVQQDDBNDZXJ0dW0g
    U01JTUUgUlNBIENBMB4XDTI1MTIwOTExMDEzMloXDTI3MTIwOTExMDEzMVowgcsxGTAXBgNVBGET
    EFZBVFBMLTUyMTMwMTcyMjgxCzAJBgNVBAYTAlBMMRQwEgYDVQQIDAttYXpvd2llY2tpZTERMA8G
    A1UEBwwIV2Fyc3phd2ExKjAoBgNVBAoMIVpha8WCYWQgVWJlenBpZWN6ZcWEIFNwb8WCZWN6bnlj
    aDEqMCgGA1UEAwwhWmFrxYJhZCBVYmV6cGllY3plxYQgU3BvxYJlY3pueWNoMSAwHgYJKoZIhvcN
    AQkBFhFzZXJ3aXNfRVdEQHp1cy5wbDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAPDO
    0kyVz9meNZ6QM3fhVpsWaTzBo02Ll4vOehAgqxwbUokqpsE1j6ATDjsNnlt+hfUwWhhDi7pZ6gYe
    kQOEntxfw9/ig1ZFCdgaPEswrw/gfk+OapxJOBV8DtmfFI7+Kvpc4qaJshX9Eh/lMQraiTb4kRWh
    GKczxTe9/Wy5GsY3OUrwq/7xHFJSpxdkVCumrEJkL90vW5C9XQwwLV17/ho82rUGE2eshwurkWox
    wXYPK1RWzIFEGpcrR9xza+/bLGsJsg58+zo/wk0WJk7eiMRNAgB/u4BgpXxSi6Sx4FR+DtpQRXwe
    LEBYULeRvia57914hJozF6zqXsYiqX+EI40CAwEAAaOCAbYwggGyMAwGA1UdEwEB/wQCMAAwQQYD
    VR0fBDowODA2oDSgMoYwaHR0cDovL2NzbWltZXJzYWNhLmNybC5jZXJ0dW0ucGwvY3NtaW1lcnNh
    Y2EuY3JsMIGDBggrBgEFBQcBAQR3MHUwLgYIKwYBBQUHMAGGImh0dHA6Ly9jc21pbWVyc2FjYS5v
    Y3NwLWNlcnR1bS5jb20wQwYIKwYBBQUHMAKGN2h0dHA6Ly9jc21pbWVyc2FjYS5yZXBvc2l0b3J5
    LmNlcnR1bS5wbC9jc21pbWVyc2FjYS5jZXIwHwYDVR0jBBgwFoAUZvvDD770v+CcyatN3kcZvcDK
    pmgwHQYDVR0OBBYEFNHnrW/mElLOi5RcxIUsuJlzllFwMEwGA1UdIARFMEMwCQYHZ4EMAQUCAjA2
    BgsqhGgBhvZ3AmQDATAnMCUGCCsGAQUFBwIBFhlodHRwczovL3d3dy5jZXJ0dW0ucGwvQ1BTMB0G
    A1UdJQQWMBQGCCsGAQUFBwMEBggrBgEFBQcDAjAOBgNVHQ8BAf8EBAMCBPAwHAYDVR0RBBUwE4ER
    c2Vyd2lzX0VXREB6dXMucGwwDQYJKoZIhvcNAQELBQADggIBAEZTE54DVFDgBeYjylrwTeeL4vpJ
    z5SdWTPkUiO+nkebnCQ/9aNXHKuLyNkKNiwJktc3acs8hDnIelFQ0JuRGbq4usvdmyyi2SXPl9Ks
    H0hKDAhaZho7PBghgahX7B7JM9UbrhNlTgOiuZ7c8HGDPeuRxF4VpwHlPSHCXYaFU6hHd3QYYrZr
    T6FTDWaubYUY/WqDv7/9UJYJ2EExVmdMZC5z22XaobEPVAMlh+GLEMaqYbe0166xie49iw/dVBea
    +4qYDitMGI4Cdt0rIjTUICcSJxrICLxPR4+XJxEHZvEzV79BDfbASCPKRdDBzrPSc0F3vhI0e6ji
    LUh36oO0sWaK2QXouLNXgNiQyMMZn6wPTbxtQXH2eBsL5EtuAUbYxy+yl5QW/gnh0CzZOTUiX9H3
    83Lb1zXzDT7w5lh732DOwhcoZe2VjMtKJlqndmSR02SQZEMkeaLXYxgYvkWXv7zoMkeyztbEm0XS
    6Eo0TYnvqZnhR6YtokT8BeGWCpBHQphiMai5XhQ5okMdV9JvKBn1EAvnmLpBWGqPcVQGgouBjuc1
    wGxwVLiZWHzlccFKdXMTfdNs6+8QPdMjD4lJDr7Z15dNBfdIzrk2MrULsNMLNEIuA7veYXflybl9
    NPTgEDgZ6WdPp/YMx4akuMauBVOl+K+15nJM7doza3JYxROH`,
};

/** The certificate of the environment as DER — refused when it is no longer (or not yet) valid. */
export function certyfikatZus(srodowisko: ZusSrodowisko, teraz = Date.now()): Buffer {
  const der = Buffer.from(PEM[srodowisko].replace(/\s+/g, ''), 'base64');
  const x509 = new X509Certificate(der);
  if (teraz > Date.parse(x509.validTo) || teraz < Date.parse(x509.validFrom)) {
    throw new AppError('zusCertZusExpired', { date: new Date(x509.validTo).toISOString().slice(0, 10) });
  }
  return der;
}
