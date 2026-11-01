using CertificateEngine.Configuration;
using Xunit;

namespace CertificateEngine.Tests;

public sealed class SmtpOptionsTests
{
    [Fact]
    public void ResendPort465ConfigurationUsesImplicitTlsMode()
    {
        var options = new SmtpOptions
        {
            Enabled = true,
            Host = "smtp.resend.com",
            Port = 465,
            UseStartTls = false,
            Username = "resend",
            FromAddress = "onboarding@resend.dev"
        };

        Assert.True(options.Enabled);
        Assert.Equal("smtp.resend.com", options.Host);
        Assert.Equal(465, options.Port);
        Assert.False(options.UseStartTls);
        Assert.Equal("resend", options.Username);
        Assert.Equal("onboarding@resend.dev", options.FromAddress);
        Assert.Empty(options.Password);
    }
}
